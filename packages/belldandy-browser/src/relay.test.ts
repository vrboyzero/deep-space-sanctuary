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

    it("reports lifecycle counters and clears a pending CDP request when the extension disconnects", async () => {
        const relay = new RelayServer(0, { token: relayToken, requestTimeoutMs: 10_000 });
        relays.push(relay);
        await relay.start();
        const baseUrl = `ws://127.0.0.1:${relay.port}`;
        const extension = new WebSocket(
            `${baseUrl}/extension`,
            `belldandy-relay-v1.${relayToken}`,
            { origin: "chrome-extension://test-extension" },
        );
        const cdp = new WebSocket(`${baseUrl}/cdp`, {
            headers: { Authorization: `Bearer ${relayToken}` },
        });
        await Promise.all([waitForOpen(extension), waitForOpen(cdp)]);

        expect(relay.getLifecycleSnapshot()).toEqual({
            state: "running",
            httpListening: true,
            extensionConnected: true,
            extensionConnectionCount: 1,
            cdpClientCount: 1,
            pendingRequestCount: 0,
        });

        cdp.send(JSON.stringify({ id: 7, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
        await waitForJsonMessage(extension, (message) => message.method === "forwardCDPCommand");
        expect(relay.getLifecycleSnapshot().pendingRequestCount).toBe(1);

        const responsePromise = waitForJsonMessage(cdp, (message) => message.id === 7);
        extension.close();
        const response = await responsePromise;
        expect(response).toMatchObject({ id: 7, error: { message: "Extension disconnected" } });
        expect(relay.getLifecycleSnapshot()).toMatchObject({
            extensionConnected: false,
            cdpClientCount: 1,
            pendingRequestCount: 0,
        });

        await relay.stop();
        await relay.stop();
        expect(relay.getLifecycleSnapshot()).toEqual({
            state: "stopped",
            httpListening: false,
            extensionConnected: false,
            extensionConnectionCount: 1,
            cdpClientCount: 0,
            pendingRequestCount: 0,
        });
    });

    it("force-terminates an unresponsive WebSocket peer within the shutdown grace", async () => {
        const relay = new RelayServer(0, {
            token: relayToken,
            shutdownGraceMs: 20,
        });
        relays.push(relay);
        await relay.start();
        const extension = new WebSocket(
            `ws://127.0.0.1:${relay.port}/extension`,
            `belldandy-relay-v1.${relayToken}`,
            { origin: "chrome-extension://test-extension" },
        );
        extension.on("error", () => {});
        await waitForOpen(extension);
        (extension as any)._socket.pause();

        const startedAt = Date.now();
        await relay.stop();

        expect(Date.now() - startedAt).toBeLessThan(1_000);
        expect(relay.getLifecycleSnapshot()).toEqual({
            state: "stopped",
            httpListening: false,
            extensionConnected: false,
            extensionConnectionCount: 1,
            cdpClientCount: 0,
            pendingRequestCount: 0,
        });
    }, 2_000);

    it("requests one extension reconnect and records the replacement connection", async () => {
        const relay = new RelayServer(0, { token: relayToken });
        relays.push(relay);
        await relay.start();
        const baseUrl = `ws://127.0.0.1:${relay.port}`;
        const first = new WebSocket(
            `${baseUrl}/extension`,
            `belldandy-relay-v1.${relayToken}`,
            { origin: "chrome-extension://test-extension" },
        );
        await waitForOpen(first);
        const firstClosed = new Promise<void>((resolve) => first.once("close", () => resolve()));

        expect(relay.requestExtensionReconnect()).toBe(true);
        await firstClosed;
        expect(relay.getLifecycleSnapshot()).toMatchObject({
            extensionConnected: false,
            extensionConnectionCount: 1,
        });

        const replacement = new WebSocket(
            `${baseUrl}/extension`,
            `belldandy-relay-v1.${relayToken}`,
            { origin: "chrome-extension://test-extension" },
        );
        await waitForOpen(replacement);
        expect(relay.getLifecycleSnapshot()).toMatchObject({
            extensionConnected: true,
            extensionConnectionCount: 2,
        });
        replacement.close();
    });
});

async function waitForOpen(socket: WebSocket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
    });
}

async function waitForJsonMessage(
    socket: WebSocket,
    predicate: (message: Record<string, any>) => boolean,
): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
        const onMessage = (data: WebSocket.RawData) => {
            try {
                const message = JSON.parse(data.toString()) as Record<string, any>;
                if (!predicate(message)) return;
                cleanup();
                resolve(message);
            } catch (error) {
                cleanup();
                reject(error);
            }
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
            socket.off("message", onMessage);
            socket.off("error", onError);
        };
        socket.on("message", onMessage);
        socket.on("error", onError);
    });
}
