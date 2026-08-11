import crypto from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";

import { assertValidRelayToken } from "./relay-credential.js";

// Logger interface to avoid circular dependency
interface Logger {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}

// 插件通信消息类型定义
type ExtensionMessage =
    | { method: "ping" }
    | { method: "pong" }
    | { id: number; result?: unknown; error?: string } // 对指令的响应
    | { method: "forwardCDPEvent"; params: { method: string; params?: unknown; sessionId?: string } }; // 来自插件的事件

type CdpCommand = {
    id: number;
    method: string;
    params?: unknown;
    sessionId?: string;
};

type CdpResponse = {
    id: number;
    result?: unknown;
    error?: { code?: number; message: string };
    sessionId?: string;
};

export type RelayServerOptions = {
    token: string;
    maxPayloadBytes?: number;
    maxCdpClients?: number;
    maxPendingRequests?: number;
    requestTimeoutMs?: number;
    shutdownGraceMs?: number;
};

export type RelayServerLifecycleSnapshot = {
    state: "created" | "starting" | "running" | "stopping" | "stopped";
    httpListening: boolean;
    extensionConnected: boolean;
    extensionConnectionCount: number;
    cdpClientCount: number;
    pendingRequestCount: number;
};

type RelayEndpoint = "extension" | "cdp";

const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024;
const DEFAULT_MAX_CDP_CLIENTS = 8;
const DEFAULT_MAX_PENDING_REQUESTS = 64;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const EXTENSION_PROTOCOL_PREFIX = "belldandy-relay-v1.";

export class RelayServer {
    private server: Server;
    private wssExtension: WebSocketServer;
    private wssCdp: WebSocketServer;
    private extensionWs: WebSocket | null = null;
    private cdpClients = new Set<WebSocket>();
    private extensionGeneration = 0;
    private stopPromise: Promise<void> | null = null;
    private lifecycleState: RelayServerLifecycleSnapshot["state"] = "created";

    // 发送给插件的挂起请求（等待响应）
    private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
    private nextId = 1;

    public port: number;
    private logger?: Logger;
    private readonly token: string;
    private readonly maxPayloadBytes: number;
    private readonly maxCdpClients: number;
    private readonly maxPendingRequests: number;
    private readonly requestTimeoutMs: number;
    private readonly shutdownGraceMs: number;

    constructor(port: number, options: RelayServerOptions, logger?: Logger) {
        this.logger = logger;
        this.port = port;
        this.token = assertValidRelayToken(options.token);
        this.maxPayloadBytes = normalizePositiveLimit(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, "maxPayloadBytes");
        this.maxCdpClients = normalizePositiveLimit(options.maxCdpClients, DEFAULT_MAX_CDP_CLIENTS, "maxCdpClients");
        this.maxPendingRequests = normalizePositiveLimit(options.maxPendingRequests, DEFAULT_MAX_PENDING_REQUESTS, "maxPendingRequests");
        this.requestTimeoutMs = normalizePositiveLimit(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs");
        this.shutdownGraceMs = normalizePositiveLimit(options.shutdownGraceMs, DEFAULT_SHUTDOWN_GRACE_MS, "shutdownGraceMs");
        this.server = createServer((req, res) => {
            const requestUrl = new URL(req.url ?? "/", "http://localhost");
            // 基础健康检查与版本信息
            if (requestUrl.pathname === "/json/version") {
                res.writeHead(200, { "Content-Type": "application/json" });
                const wsUrl = `ws://127.0.0.1:${this.port}/cdp`;
                res.end(JSON.stringify({
                    Browser: "Star Sanctuary/Relay",
                    "Protocol-Version": "1.3",
                    // 未认证 discovery 不返回可复用 credential，避免 loopback 探测直接获得 CDP 控制路径。
                    webSocketDebuggerUrl: this.isRequestAuthenticated(req) && this.isExtensionConnected() ? wsUrl : undefined
                }));
                return;
            }
            if (requestUrl.pathname === "/json/list") {
                // 返回一个虚拟 Target，以便 Puppeteer 可以通过 http://.../json/list 进行发现。
                // 在真实实现中，我们应该追踪 Tab 列表。目前暂时返回空数组或单个 Target。
                // Puppeteer 通常通过 /json/version 获取 webSocketDebuggerUrl。
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify([]));
                return;
            }
            res.writeHead(404);
            res.end("Not Found");
        });

        this.wssExtension = new WebSocketServer({ noServer: true, maxPayload: this.maxPayloadBytes });
        this.wssCdp = new WebSocketServer({ noServer: true, maxPayload: this.maxPayloadBytes });

        this.setupExtensionServer();
        this.setupCdpServer();

        this.server.on("upgrade", (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const endpoint = url.pathname === "/extension"
                ? "extension"
                : url.pathname === "/cdp"
                    ? "cdp"
                    : null;
            if (!endpoint) {
                socket.destroy();
                return;
            }
            const wss = endpoint === "extension" ? this.wssExtension : this.wssCdp;
            wss.handleUpgrade(req, socket, head, (ws) => {
                const rejection = this.getUpgradeRejection(req, endpoint);
                if (rejection) {
                    safeClose(ws, rejection.code, rejection.reason);
                    return;
                }
                wss.emit("connection", ws, req);
            });
        });
    }

    private isRequestAuthenticated(req: IncomingMessage, endpoint: RelayEndpoint = "cdp"): boolean {
        const supplied = endpoint === "extension"
            ? getExtensionProtocolToken(req)
            : getBearerToken(req);
        if (!supplied) return false;
        const expected = Buffer.from(this.token);
        const candidate = Buffer.from(supplied);
        return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
    }

    private getUpgradeRejection(
        req: IncomingMessage,
        endpoint: RelayEndpoint,
    ): { code: number; reason: string } | null {
        if (!this.isRequestAuthenticated(req, endpoint)) {
            return { code: 4401, reason: "relay credential required" };
        }
        if (!isRelayOriginAllowed(req.headers.origin, endpoint)) {
            return { code: 4403, reason: "relay origin rejected" };
        }
        if (endpoint === "extension" && this.isExtensionConnected()) {
            return { code: 4409, reason: "extension owner already connected" };
        }
        if (endpoint === "cdp" && this.cdpClients.size >= this.maxCdpClients) {
            return { code: 4429, reason: "cdp client limit reached" };
        }
        return null;
    }

    private isExtensionConnected(): boolean {
        return this.extensionWs?.readyState === WebSocket.OPEN;
    }

    private rejectPending(reason: string): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this.pending.clear();
    }

    private setupExtensionServer() {
        this.wssExtension.on("connection", (ws) => {
            const generation = ++this.extensionGeneration;
            this.logger?.info("Extension connected", { generation });
            this.extensionWs = ws;

            ws.on("message", (data) => {
                const dataStr = data.toString();
                try {
                    const msg = JSON.parse(dataStr) as ExtensionMessage;
                    if (!("method" in msg && (msg.method === "ping" || msg.method === "pong"))) {
                        this.logger?.debug("Extension message received", {
                            generation,
                            bytes: Buffer.byteLength(dataStr),
                            kind: "method" in msg ? msg.method : "response",
                        });
                    }
                    this.handleExtensionMessage(msg);
                } catch {
                    // Bad frames are rejected without logging their potentially sensitive payload.
                    this.logger?.warn("Rejected invalid extension message", { generation, bytes: Buffer.byteLength(dataStr) });
                    safeClose(ws, 4400, "invalid extension frame");
                }
            });

            ws.on("close", () => {
                if (this.extensionWs !== ws || generation !== this.extensionGeneration) {
                    return;
                }
                this.logger?.info("Extension disconnected", { generation });
                this.extensionWs = null;
                this.rejectPending("Extension disconnected");
            });
        });
    }

    private setupCdpServer() {
        this.wssCdp.on("connection", (ws) => {
            this.logger?.debug("CDP client connected", { clients: this.cdpClients.size + 1 });
            this.cdpClients.add(ws);

            ws.on("message", async (data) => {
                const cmd = parseCdpCommand(data.toString());
                if (!cmd) {
                    safeClose(ws, 4400, "invalid cdp command");
                    return;
                }
                if (!this.isExtensionConnected()) {
                    this.sendJson(ws, {
                        id: cmd.id,
                        error: {
                            code: -32000,
                            message: "Browser extension is not connected.",
                        },
                        sessionId: cmd.sessionId,
                    });
                    return;
                }

                await this.handleCdpCommand(ws, cmd);
            });

            ws.on("close", () => {
                this.cdpClients.delete(ws);
            });
        });
    }

    private handleExtensionMessage(msg: ExtensionMessage) {
        if ("method" in msg) {
            if (msg.method === "ping") {
                this.sendJson(this.extensionWs, { method: "pong" });
                return;
            }
            if (msg.method === "forwardCDPEvent") {
                // 广播事件给所有连接的 CDP Clients
                const cdpEvent = {
                    method: msg.params.method,
                    params: msg.params.params,
                    sessionId: msg.params.sessionId
                };

                // Patch: Inject browserContextId for attachedToTarget events
                // to match the one we mocked in targetCreated
                if (cdpEvent.method === "Target.attachedToTarget") {
                    const info = (cdpEvent.params as any).targetInfo;
                    if (info) {
                        info.browserContextId = "default-context";
                        if (!info.url) info.url = "http://localhost/placeholder";
                        if (!info.title) info.title = "Active Tab";
                    }
                }
                for (const client of this.cdpClients) {
                    this.sendJson(client, cdpEvent);
                }
            }
            return;
        }

        if ("id" in msg && typeof msg.id === "number") {
            // 收到我们发送指令的响应
            const p = this.pending.get(msg.id);
            if (p) {
                clearTimeout(p.timer);
                this.pending.delete(msg.id);
                if (msg.error) p.reject(new Error(msg.error));
                else p.resolve(msg.result);
            }
            return;
        }
    }

    private async handleCdpCommand(client: WebSocket, cmd: CdpCommand) {
        this.logger?.debug("CDP command received", { method: cmd.method, id: cmd.id });

        // Intercept specific commands
        if (cmd.method === "Target.getBrowserContexts") {
            const response: CdpResponse = {
                id: cmd.id,
                result: {
                    browserContextIds: ["default-context"]
                },
                sessionId: cmd.sessionId
            };
            this.sendJson(client, response, "Sending contexts");
            return;
        }

        if (cmd.method === "Target.setDiscoverTargets") {
            // CRITICAL: Emit Target.targetCreated for existing targets so Puppeteer discovers them
            // Send event BEFORE response
            const targetEvent = {
                method: "Target.targetCreated",
                params: {
                    targetInfo: {
                        targetId: "page-1",
                        type: "page",
                        title: "Active Tab",
                        url: "http://localhost/placeholder",
                        attached: false,
                        canAccessOpener: false,
                        browserContextId: "default-context" // Link to context
                    }
                }
            };
            this.sendJson(client, targetEvent, "Sending targetCreated");

            const response: CdpResponse = {
                id: cmd.id,
                result: {},
                sessionId: cmd.sessionId
            };
            this.sendJson(client, response);

            return;
        }

        if (cmd.method === "Target.setAutoAttach") {
            // 1. Respond OK to the setAutoAttach command itself
            const response: CdpResponse = {
                id: cmd.id,
                result: {},
                sessionId: cmd.sessionId
            };
            this.sendJson(client, response);

            // CRITICAL FIX: Only trigger "Connect to page-1" if this command comes from the BROWSWER (root)
            // If it comes from an existing Session (cmd.sessionId is present), it's Puppeteer looking for iframes/workers.
            // We must NOT trigger a new Page Loop here.
            if (!cmd.sessionId) {
                // 2. TRIGGER the actual attachment via Extension
                // console.log("[Relay] Triggering Extension Attach for page-1 (Root Spec)");
                const attachParams = {
                    targetId: "page-1",
                    flatten: true
                };

                // Send internal command to extension
                const internalId = -999;
                const payload = {
                    method: "forwardCDPCommand",
                    params: {
                        method: "Target.attachToTarget",
                        params: attachParams,
                        sessionId: undefined
                    },
                    id: internalId
                };
                this.sendJson(this.extensionWs, payload);
            }

            return;
        }

        if (cmd.method === "Target.getTargets") {
            // Return a single virtual target representing the active tab
            // In a better implementation, we would track this from Extension events.
            const response: CdpResponse = {
                id: cmd.id,
                result: {
                    targetInfos: [
                        {
                            targetId: "page-1", // Fixed ID for simplicity
                            type: "page",
                            title: "Active Tab",
                            url: "about:blank",
                            attached: false, // Puppeteer will try to attach
                            canAccessOpener: false,
                            browserContextId: "default-context"
                        }
                    ]
                },
                sessionId: cmd.sessionId
            };
            this.sendJson(client, response);
            return;
        }

        // Forward others to extension

        const id = this.nextId++;
        const payload = {
            id,
            method: "forwardCDPCommand",
            params: {
                method: cmd.method,
                params: cmd.params,
                sessionId: cmd.sessionId
            }
        };

        try {
            if (!this.isExtensionConnected() || !this.extensionWs) {
                throw new Error("Extension not connected");
            }
            if (this.pending.size >= this.maxPendingRequests) {
                throw new Error("Relay pending request limit reached");
            }

            // 先登记 pending 再发送，防止 Extension 快速响应时丢失结果。
            const result = await new Promise<unknown>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error("Timeout waiting for extension"));
                }, this.requestTimeoutMs);
                this.pending.set(id, { resolve, reject, timer });
                if (!this.sendJson(this.extensionWs, payload)) {
                    clearTimeout(timer);
                    this.pending.delete(id);
                    reject(new Error("Extension connection is not writable"));
                }
            });

            // 将结果回传给 CDP Client
            const response: CdpResponse = {
                id: cmd.id,
                result,
                sessionId: cmd.sessionId
            };
            this.sendJson(client, response);

        } catch (err) {
            const response: CdpResponse = {
                id: cmd.id,
                error: { message: err instanceof Error ? err.message : String(err) },
                sessionId: cmd.sessionId
            };
            this.sendJson(client, response);
        }
    }

    private sendJson(
        socket: Pick<WebSocket, "send"> | null | undefined,
        payload: unknown,
        debugLabel?: string,
    ): boolean {
        if (!socket) return false;
        const relaySocket = socket as Partial<Pick<WebSocket, "readyState" | "bufferedAmount" | "close">>;
        if (relaySocket.readyState !== undefined && relaySocket.readyState !== WebSocket.OPEN) return false;
        if (typeof relaySocket.bufferedAmount === "number" && relaySocket.bufferedAmount > MAX_BUFFERED_BYTES) {
            if (typeof relaySocket.close === "function") {
                safeClose(relaySocket as WebSocket, 1013, "relay consumer is too slow");
            }
            return false;
        }
        const serialized = JSON.stringify(payload);
        const bytes = Buffer.byteLength(serialized);
        if (bytes > this.maxPayloadBytes) {
            this.logger?.warn("Rejected oversized relay outbound frame", { bytes });
            return false;
        }
        if (debugLabel) {
            this.logger?.debug(`${debugLabel} (bytes=${bytes})`);
        }
        try {
            socket.send(serialized);
            return true;
        } catch {
            return false;
        }
    }

    public async start(): Promise<void> {
        if (this.lifecycleState !== "created") {
            throw new Error(`Relay server cannot start from ${this.lifecycleState} state.`);
        }
        this.lifecycleState = "starting";
        return new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
                this.server.off("error", onError);
                this.lifecycleState = "created";
                reject(error);
            };
            this.server.once("error", onError);
            this.server.listen(this.port, "127.0.0.1", () => {
                this.server.off("error", onError);
                const address = this.server.address();
                if (address && typeof address !== "string") {
                    this.port = (address as AddressInfo).port;
                }
                this.lifecycleState = "running";
                this.logger?.info(`Relay server listening on 127.0.0.1:${this.port}`);
                resolve();
            });
        });
    }

    public getLifecycleSnapshot(): RelayServerLifecycleSnapshot {
        return {
            state: this.lifecycleState,
            httpListening: this.server.listening,
            extensionConnected: this.isExtensionConnected(),
            extensionConnectionCount: this.extensionGeneration,
            cdpClientCount: this.cdpClients.size,
            pendingRequestCount: this.pending.size,
        };
    }

    public requestExtensionReconnect(): boolean {
        if (!this.isExtensionConnected() || !this.extensionWs) return false;
        safeClose(this.extensionWs, 1012, "relay reconnect requested");
        return true;
    }

    public async stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        this.stopPromise = (async () => {
            this.lifecycleState = "stopping";
            try {
                this.rejectPending("Relay stopped");
                this.extensionWs && safeClose(this.extensionWs, 1001, "relay stopped");
                for (const client of this.cdpClients) {
                    safeClose(client, 1001, "relay stopped");
                }
                this.cdpClients.clear();
                this.extensionWs = null;
                await Promise.all([
                    closeWebSocketServer(this.wssExtension, this.shutdownGraceMs),
                    closeWebSocketServer(this.wssCdp, this.shutdownGraceMs),
                    closeHttpServer(this.server, this.shutdownGraceMs),
                ]);
            } finally {
                this.lifecycleState = "stopped";
            }
        })();
        return this.stopPromise;
    }
}

function normalizePositiveLimit(value: number | undefined, fallback: number, label: string): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return value;
}

/** Chrome 扩展不能自定义 Authorization；将凭据放在受握手保护的子协议字段而非 URL。 */
function getExtensionProtocolToken(req: IncomingMessage): string | undefined {
    const rawProtocols = req.headers["sec-websocket-protocol"];
    const protocols = (Array.isArray(rawProtocols) ? rawProtocols.join(",") : rawProtocols ?? "")
        .split(",")
        .map((protocol) => protocol.trim())
        .filter(Boolean);
    const credentialProtocol = protocols.find((protocol) => protocol.startsWith(EXTENSION_PROTOCOL_PREFIX));
    return credentialProtocol?.slice(EXTENSION_PROTOCOL_PREFIX.length);
}

/** CDP/Puppeteer 支持握手 headers，使用标准 Authorization 防止 token 进入 endpoint 字符串。 */
function getBearerToken(req: IncomingMessage): string | undefined {
    const authorization = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
    const matched = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
    return matched?.[1]?.trim() || undefined;
}

function isRelayOriginAllowed(origin: string | string[] | undefined, endpoint: RelayEndpoint): boolean {
    const value = Array.isArray(origin) ? origin[0] : origin;
    if (!value) return endpoint === "cdp";
    try {
        const parsed = new URL(value);
        if (endpoint === "extension") return parsed.protocol === "chrome-extension:";
        return (parsed.protocol === "http:" || parsed.protocol === "https:")
            && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
    } catch {
        return false;
    }
}

function parseCdpCommand(raw: string): CdpCommand | null {
    try {
        const value = JSON.parse(raw) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const record = value as Record<string, unknown>;
        if (typeof record.id !== "number" || !Number.isSafeInteger(record.id) || typeof record.method !== "string" || !record.method.trim()) return null;
        return {
            id: record.id,
            method: record.method,
            ...(record.params !== undefined ? { params: record.params } : {}),
            ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
        };
    } catch {
        return null;
    }
}

function safeClose(socket: WebSocket, code: number, reason: string): void {
    try {
        socket.close(code, reason);
    } catch {
        // Socket can already be closed while shutdown is draining it.
    }
}

async function closeWebSocketServer(wss: WebSocketServer, graceMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
        let settled = false;
        let hardTimer: NodeJS.Timeout | undefined;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(forceTimer);
            if (hardTimer) clearTimeout(hardTimer);
            resolve();
        };
        const forceTimer = setTimeout(() => {
            for (const client of wss.clients) {
                try {
                    client.terminate();
                } catch {
                    // A concurrent close may already have released the socket.
                }
            }
            hardTimer = setTimeout(finish, graceMs);
            hardTimer.unref();
        }, graceMs);
        forceTimer.unref();
        try {
            wss.close(finish);
        } catch {
            finish();
        }
    });
}

async function closeHttpServer(server: Server, graceMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
        let settled = false;
        let hardTimer: NodeJS.Timeout | undefined;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(forceTimer);
            if (hardTimer) clearTimeout(hardTimer);
            resolve();
        };
        const forceTimer = setTimeout(() => {
            server.closeAllConnections?.();
            hardTimer = setTimeout(finish, graceMs);
            hardTimer.unref();
        }, graceMs);
        forceTimer.unref();
        try {
            server.close(finish);
        } catch {
            finish();
        }
    });
}
