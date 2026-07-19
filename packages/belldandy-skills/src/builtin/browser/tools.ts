import puppeteer, { Browser, Page } from "puppeteer-core";
import { Tool, ToolContext, ToolCallResult } from "../../types.js";
import path from "node:path";
import fs from "node:fs/promises";
import WebSocket from "ws";
import {
    OutboundRequestPolicy,
    OutboundRequestPolicyError,
    redactSensitiveText,
    redactSensitiveUrl,
    type OutboundRequestPolicyOptions,
} from "@belldandy/protocol";
import { withToolContract } from "../../tool-contract.js";
import { raceWithAbort, sleepWithAbort, throwIfAborted, toAbortError } from "../../abort-utils.js";
import { understandCapturedImageArtifact } from "../multimedia/captured-image-understand.js";

// Logger interface to avoid circular dependency
interface Logger {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}

function getRelayConnection(): { endpoint: string; headers: Record<string, string> } {
    const rawPort = process.env.BELLDANDY_RELAY_PORT?.trim() || "28892";
    const port = Number(rawPort);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new Error("Browser Relay port is invalid.");
    }
    const token = process.env.BELLDANDY_RELAY_TOKEN?.trim();
    if (!token) {
        throw new Error("Browser Relay credential is not configured.");
    }
    return {
        endpoint: `ws://127.0.0.1:${port}/cdp`,
        headers: { Authorization: `Bearer ${token}` },
    };
}

import { SNAPSHOT_SCRIPT } from "./snapshot.js";

// Global logger instance (set by BrowserManager)
let browserLogger: Logger | undefined;

export function setBrowserLogger(logger: Logger) {
    browserLogger = logger;
}

type PageLike = {
    url(): string;
    isClosed(): boolean;
    target(): unknown;
};

type PageSelectionOptions = {
    preferredTargetId?: string;
    preferredUrl?: string;
};

function getComparablePageUrl(url: string | undefined): string {
    if (!url) return "";
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        return parsed.toString();
    } catch {
        return url;
    }
}

export function getTargetId(value: unknown): string | undefined {
    const candidate = value as {
        _targetId?: unknown;
        targetId?: unknown;
        _targetInfo?: { targetId?: unknown };
        _target?: { _targetId?: unknown; _targetInfo?: { targetId?: unknown } };
    } | undefined;

    const raw = candidate?._targetId
        ?? candidate?.targetId
        ?? candidate?._targetInfo?.targetId
        ?? candidate?._target?._targetId
        ?? candidate?._target?._targetInfo?.targetId;

    return typeof raw === "string" && raw.trim() ? raw : undefined;
}

export function selectPreferredPage<T extends PageLike>(pages: T[], options: PageSelectionOptions): T | undefined {
    const openPages = pages.filter(page => !page.isClosed());
    if (openPages.length === 0) {
        return undefined;
    }

    if (options.preferredTargetId) {
        const preferredByTarget = openPages.find(page => getTargetId(page.target()) === options.preferredTargetId);
        if (preferredByTarget) {
            return preferredByTarget;
        }
    }

    if (options.preferredUrl) {
        const preferredUrl = getComparablePageUrl(options.preferredUrl);
        const preferredByUrl = openPages.find(page => getComparablePageUrl(page.url()) === preferredUrl);
        if (preferredByUrl) {
            return preferredByUrl;
        }
    }

    return openPages[openPages.length - 1];
}

// =========================================
// Direct CDP Helper - 绕过 Puppeteer 的 session 管理
// =========================================
async function sendCdpCommand(
    method: string,
    params: Record<string, unknown> = {},
    timeout = 15000,
    signal?: AbortSignal,
): Promise<unknown> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const relay = getRelayConnection();
        const ws = new WebSocket(relay.endpoint, { headers: relay.headers });
        const timeoutId = setTimeout(() => {
            ws.close();
            reject(new Error(`CDP command ${method} timed out after ${timeout}ms`));
        }, timeout);
        const onAbort = () => {
            clearTimeout(timeoutId);
            ws.close();
            reject(toAbortError(signal?.reason));
        };

        const id = Date.now();
        signal?.addEventListener("abort", onAbort, { once: true });

        ws.on("open", () => {
            ws.send(JSON.stringify({ id, method, params }));
        });

        ws.on("message", (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.id === id) {
                    clearTimeout(timeoutId);
                    signal?.removeEventListener("abort", onAbort);
                    ws.close();
                    if (msg.error) {
                        reject(new Error(msg.error.message || msg.error));
                    } else {
                        resolve(msg.result);
                    }
                }
            } catch (err) {
                // Ignore parse errors for events
            }
        });

        ws.on("error", (err) => {
            clearTimeout(timeoutId);
            signal?.removeEventListener("abort", onAbort);
            reject(err);
        });

        ws.on("close", () => {
            clearTimeout(timeoutId);
            signal?.removeEventListener("abort", onAbort);
        });
    });
}

export async function waitForPreferredPageSelection<T extends PageLike>(input: {
    listPages: () => Promise<T[]>;
    preferred: PageSelectionOptions;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<T | undefined> {
    const timeoutMs = input.timeoutMs ?? 5000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
        throwIfAborted(input.signal);
        const selected = selectPreferredPage(await input.listPages(), input.preferred);
        if (selected) {
            return selected;
        }
        await sleepWithAbort(100, input.signal);
    }

    return undefined;
}

type BrowserUrlPolicy = Pick<OutboundRequestPolicy, "resolveAllowedAddresses">;
export type BrowserOutboundProfile = "public-web" | "privileged-local-browser";
type BrowserOutboundRequestPolicyOverrides = Omit<
    OutboundRequestPolicyOptions,
    "allowPrivateNetwork"
>;

export async function validateBrowserUrl(
    urlStr: string,
    policy: BrowserUrlPolicy = createBrowserOutboundRequestPolicy(),
): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        await policy.resolveAllowedAddresses(urlStr);
        return { ok: true };
    } catch (error) {
        if (error instanceof OutboundRequestPolicyError) {
            return { ok: false, error: formatBrowserUrlPolicyError(error) };
        }
        return { ok: false, error: "浏览器 URL 安全校验失败" };
    }
}

export function resolveBrowserOutboundProfile(
    value: string | undefined = process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE,
): BrowserOutboundProfile {
    return value?.trim().toLowerCase() === "privileged-local-browser"
        ? "privileged-local-browser"
        : "public-web";
}

export function createBrowserOutboundRequestPolicy(
    profile: BrowserOutboundProfile = resolveBrowserOutboundProfile(),
    overrides: BrowserOutboundRequestPolicyOverrides = {},
): OutboundRequestPolicy {
    return new OutboundRequestPolicy({
        ...overrides,
        allowedHosts: overrides.allowedHosts
            ?? readBrowserHostRules("BELLDANDY_BROWSER_ALLOWED_DOMAINS"),
        deniedHosts: overrides.deniedHosts
            ?? readBrowserHostRules("BELLDANDY_BROWSER_DENIED_DOMAINS"),
        allowInsecureHttp: overrides.allowInsecureHttp
            ?? isExplicitlyEnabled("BELLDANDY_BROWSER_ALLOW_INSECURE_HTTP"),
        // 私网能力只能由命名 profile 提升，不能由任意 policy override 绕过。
        allowPrivateNetwork: profile === "privileged-local-browser",
    });
}

function readBrowserHostRules(name: string): string[] {
    return (process.env[name] ?? "")
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean);
}

function formatBrowserUrlPolicyError(error: OutboundRequestPolicyError): string {
    switch (error.code) {
        case "invalid_url":
            return "无效的 URL";
        case "unsupported_scheme":
            return "浏览器仅支持 HTTP/HTTPS URL";
        case "insecure_scheme":
            return "浏览器 HTTP 访问需要显式允许";
        case "userinfo_not_allowed":
            return "浏览器 URL 不允许包含用户名或密码";
        case "host_denied":
            return "浏览器域名被禁止";
        case "host_not_allowed":
            return "浏览器域名不在白名单中";
        case "private_network_not_allowed":
            return "浏览器禁止访问内网地址";
        case "dns_unavailable":
            return "浏览器 DNS 校验失败，已拒绝导航";
        case "redirect_limit":
        case "redirect_without_location":
        case "idle_timeout":
            return "浏览器 URL 不符合安全策略";
    }
}

function isExplicitlyEnabled(name: string): boolean {
    return ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
}

export class BrowserManager {
    private static instance: BrowserManager;
    private browser: Browser | null = null;
    private activePage: Page | null = null;
    private connecting = false;
    private preferredTargetId?: string;
    private preferredUrl?: string;

    private constructor() { }

    public static getInstance(): BrowserManager {
        if (!BrowserManager.instance) {
            BrowserManager.instance = new BrowserManager();
        }
        return BrowserManager.instance;
    }

    public async connect(signal?: AbortSignal): Promise<Browser> {
        throwIfAborted(signal);
        if (this.browser && this.browser.isConnected()) {
            return this.browser;
        }

        if (this.connecting) {
            // Wait for existing connection attempt
            while (this.connecting) {
                await sleepWithAbort(100, signal);
            }
            if (this.browser && this.browser.isConnected()) {
                return this.browser;
            }
        }

        this.connecting = true;
        try {
            // Connect to Belldandy Relay
            const relay = getRelayConnection();
            this.browser = await raceWithAbort(puppeteer.connect({
                browserWSEndpoint: relay.endpoint,
                headers: relay.headers,
                defaultViewport: null, // Let browser handle viewport
            }), signal);
            browserLogger?.debug("Connected to relay");

            this.browser.on("disconnected", () => {
                browserLogger?.warn("Browser disconnected");
                this.browser = null;
                this.activePage = null;
            });

            return this.browser;
        } finally {
            this.connecting = false;
        }
    }

    private rememberPage(page: Page): Page {
        this.activePage = page;
        this.preferredTargetId = getTargetId(page.target()) ?? this.preferredTargetId;
        const currentUrl = page.url();
        if (currentUrl && currentUrl !== "about:blank") {
            this.preferredUrl = currentUrl;
        }
        return page;
    }

    public async bindToPage(preferred: PageSelectionOptions & { timeoutMs?: number; signal?: AbortSignal }): Promise<Page | null> {
        if (preferred.preferredTargetId) {
            this.preferredTargetId = preferred.preferredTargetId;
        }
        if (preferred.preferredUrl) {
            this.preferredUrl = preferred.preferredUrl;
        }

        const browser = await this.connect(preferred.signal);
        const selected = await waitForPreferredPageSelection({
            listPages: () => browser.pages(),
            preferred: {
                preferredTargetId: this.preferredTargetId,
                preferredUrl: this.preferredUrl,
            },
            timeoutMs: preferred.timeoutMs,
            signal: preferred.signal,
        });
        if (selected) {
            return this.rememberPage(selected);
        }

        browserLogger?.warn("Unable to bind preferred page", {
            preferredTargetId: this.preferredTargetId,
            preferredUrl: this.preferredUrl,
        });
        return null;
    }

    public async getPage(signal?: AbortSignal): Promise<Page> {
        const browser = await this.connect(signal);
        if (this.activePage && !this.activePage.isClosed()) {
            return this.activePage;
        }

        let pages = await browser.pages();

        const preferredPage = selectPreferredPage(pages, {
            preferredTargetId: this.preferredTargetId,
            preferredUrl: this.preferredUrl,
        });
        if (preferredPage) {
            return this.rememberPage(preferredPage);
        }

        browserLogger?.debug("Waiting for targets...");
        try {
            const target = await raceWithAbort(
                browser.waitForTarget(t => t.type() === 'page', { timeout: 5000 }),
                signal,
            );
            const page = await target.page();
            if (!page) throw new Error("Target found but no page attached");
            return this.rememberPage(page);
        } catch (err) {
            const targets = browser.targets();
            const targetDebug = targets.map(t => ({
                type: t.type(),
                url: t.url(),
                isPage: t.type() === 'page'
            }));
            browserLogger?.warn("No pages found after wait", { targets: targetDebug });

            throw new Error("No pages found. Ensure the Browser Extension is connected to the Relay.");
        }
    }

    public async close() {
        if (this.browser) {
            await this.browser.disconnect();
            this.browser = null;
        }
    }
}

// Helper to standardise tool results
const success = (
    id: string,
    name: string,
    output: string,
    start: number,
    metadata?: ToolCallResult["metadata"],
): ToolCallResult => ({
    id,
    name,
    success: true,
    output,
    durationMs: Date.now() - start,
    ...(metadata ? { metadata } : {}),
});

const failure = (id: string, name: string, error: unknown, start: number): ToolCallResult => ({
    id,
    name,
    success: false,
    output: "",
    error: redactSensitiveText(error instanceof Error ? error.message : String(error)),
    durationMs: Date.now() - start,
});

// --- Tools ---

export const browserOpenTool: Tool = withToolContract({
    definition: {
        name: "browser_open",
        description: "Open a NEW browser tab and navigate to a URL. Use this to start a browsing session without affecting the current page.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "The URL to navigate to." },
            },
            required: ["url"],
        },
    },
    execute: async (args, context) => {
        const start = Date.now();
        try {
            throwIfAborted(context.abortSignal);
            const url = args.url as string;

            // [SECURITY] 域名校验
            const validation = await validateBrowserUrl(url);
            if (!validation.ok) {
                return failure("unknown", "browser_open", validation.error, start);
            }

            browserLogger?.debug(`Creating new tab for URL: ${redactSensitiveUrl(url)}`);

            // 使用直接 CDP 命令创建标签页（绕过 Puppeteer 的 session 管理）
            // 扩展的 Target.createTarget 会直接创建带 URL 的标签页
            const result = await sendCdpCommand("Target.createTarget", { url }, 15000, context.abortSignal) as { targetId: string };
            const manager = BrowserManager.getInstance();
            await manager.bindToPage({
                preferredTargetId: result.targetId,
                preferredUrl: url,
                timeoutMs: 5000,
                signal: context.abortSignal,
            });

            browserLogger?.debug(`Successfully created tab with targetId: ${result.targetId}`);

            return success(
                "unknown",
                "browser_open",
                `成功打开新标签页: ${redactSensitiveUrl(url)}`,
                start
            );
        } catch (err) {
            browserLogger?.error("browser_open failed", err);
            return failure("unknown", "browser_open", err, start);
        }
    },
}, {
    family: "browser",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "medium",
    channels: ["gateway", "web"],
    safeScopes: ["bridge-safe"],
    activityDescription: "Open a new browser tab at the specified URL",
    resultSchema: {
        kind: "text",
        description: "Browser navigation status text.",
    },
    outputPersistencePolicy: "conversation",
});

export const browserNavigateTool: Tool = withToolContract({
    definition: {
        name: "browser_navigate",
        description: "Navigate the active tab to a new URL.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "The URL to navigate to." },
            },
            required: ["url"],
        },
    },
    execute: async (args, context) => {
        const start = Date.now();
        try {
            throwIfAborted(context.abortSignal);
            const url = args.url as string;

            // [SECURITY] 域名校验
            const validation = await validateBrowserUrl(url);
            if (!validation.ok) {
                return failure("unknown", "browser_navigate", validation.error, start);
            }

            const manager = BrowserManager.getInstance();
            const page = await manager.getPage(context.abortSignal);

            await raceWithAbort(page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }), context.abortSignal);
            await manager.bindToPage({
                preferredTargetId: getTargetId(page.target()),
                preferredUrl: page.url(),
                timeoutMs: 1000,
                signal: context.abortSignal,
            });

            return success("unknown", "browser_navigate", `Navigated to ${redactSensitiveUrl(url)}`, start);
        } catch (err) {
            return failure("unknown", "browser_navigate", err, start);
        }
    },
}, {
    family: "browser",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "medium",
    channels: ["gateway", "web"],
    safeScopes: ["bridge-safe"],
    activityDescription: "Navigate the active browser page to a URL",
    resultSchema: {
        kind: "text",
        description: "Browser navigation status text.",
    },
    outputPersistencePolicy: "conversation",
});

export const browserClickTool: Tool = withToolContract({
    definition: {
        name: "browser_click",
        description: "Click an element on the active page matched by a CSS selector OR a Snapshot ID.",
        parameters: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for the element to click. (Provide either selector OR id)" },
                id: { type: "number", description: "The numeric ID from browser_snapshot (e.g. 42). (Provide either selector OR id)" },
            },
        },
    },
    execute: async (args, context) => {
        const start = Date.now();
        try {
            throwIfAborted(context.abortSignal);
            const { selector, id } = args as { selector?: string; id?: number };
            const manager = BrowserManager.getInstance();
            const page = await manager.getPage(context.abortSignal);

            let targetSelector = selector;
            if (id !== undefined) {
                targetSelector = `[data-agent-id="${id}"]`;
            }

            if (!targetSelector) throw new Error("Either selector or id must be provided");

            await raceWithAbort(page.waitForSelector(targetSelector, { timeout: 5000 }), context.abortSignal);
            throwIfAborted(context.abortSignal);
            await page.click(targetSelector);

            return success("unknown", "browser_click", `Clicked element: ${targetSelector}`, start);
        } catch (err) {
            return failure("unknown", "browser_click", err, start);
        }
    },
}, {
    family: "browser",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "medium",
    channels: ["gateway", "web"],
    safeScopes: ["bridge-safe"],
    activityDescription: "Click an element on the active browser page",
    resultSchema: {
        kind: "text",
        description: "Browser interaction status text.",
    },
    outputPersistencePolicy: "conversation",
});

export const browserTypeTool: Tool = withToolContract({
    definition: {
        name: "browser_type",
        description: "Type text into an element on the active page matched by a CSS selector OR a Snapshot ID.",
        parameters: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for the input element. (Provide either selector OR id)" },
                id: { type: "number", description: "The numeric ID from browser_snapshot (e.g. 42). (Provide either selector OR id)" },
                text: { type: "string", description: "The text to type." },
            },
            required: ["text"],
        },
    },
    execute: async (args, context) => {
        const start = Date.now();
        try {
            throwIfAborted(context.abortSignal);
            const { selector, id, text } = args as { selector?: string; id?: number; text: string };
            const manager = BrowserManager.getInstance();
            const page = await manager.getPage(context.abortSignal);

            let targetSelector = selector;
            if (id !== undefined) {
                targetSelector = `[data-agent-id="${id}"]`;
            }

            if (!targetSelector) throw new Error("Either selector or id must be provided");

            await raceWithAbort(page.waitForSelector(targetSelector, { timeout: 5000 }), context.abortSignal);
            throwIfAborted(context.abortSignal);
            await page.type(targetSelector, text);

            return success("unknown", "browser_type", `Typed "${text}" into ${targetSelector}`, start);
        } catch (err) {
            return failure("unknown", "browser_type", err, start);
        }
    },
}, {
    family: "browser",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "medium",
    channels: ["gateway", "web"],
    safeScopes: ["bridge-safe"],
    activityDescription: "Type text into an element on the active browser page",
    resultSchema: {
        kind: "text",
        description: "Browser input status text.",
    },
    outputPersistencePolicy: "conversation",
});


export const browserScreenshotTool: Tool = withToolContract({
    definition: {
        name: "browser_screenshot",
        description: "Capture a screenshot of the active page.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Optional name for the screenshot file (without extension)." },
            },
        },
    },
    execute: async (args, context) => {
        const start = Date.now();
        try {
            throwIfAborted(context.abortSignal);
            const name = (args.name as string) || `screenshot-${Date.now()}`;
            const manager = BrowserManager.getInstance();
            const page = await manager.getPage(context.abortSignal);

            // Store in 'screenshots' directory in workspace root
            const workspaceRoot = context.workspaceRoot || process.cwd();
            const targetDir = path.join(workspaceRoot, "screenshots");

            // Ensure directory exists
            await fs.mkdir(targetDir, { recursive: true });

            // Ensure unique filename to avoid overwrites if name is reused
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const filename = `${name}_${timestamp}.png`;
            const filepath = path.join(targetDir, filename);

            throwIfAborted(context.abortSignal);
            await page.screenshot({ path: filepath });
            const imageUnderstanding = await understandCapturedImageArtifact({
                filePath: filepath,
                mimeType: "image/png",
                stateDir: context.stateDir,
                abortSignal: context.abortSignal,
                autoUnderstandEnvName: "BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND",
            });
            const payload = {
                path: filepath,
                pageUrl: typeof page.url === "function" ? page.url() : undefined,
                imageUnderstandingStatus: imageUnderstanding.status,
                ...(imageUnderstanding.status === "completed"
                    ? {
                        imageUnderstandingPreview: imageUnderstanding.preview,
                        imageUnderstanding: imageUnderstanding.result,
                    }
                    : {}),
                ...(imageUnderstanding.status === "failed"
                    ? {
                        imageUnderstandingError: imageUnderstanding.error,
                    }
                    : {}),
            };

            return {
                id: "unknown",
                name: "browser_screenshot",
                success: true,
                output: JSON.stringify(payload, null, 2),
                durationMs: Date.now() - start,
                metadata: {
                    imageUnderstandingStatus: imageUnderstanding.status,
                },
            };
        } catch (err) {
            return failure("unknown", "browser_screenshot", err, start);
        }
    },
}, {
    family: "browser",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "medium",
    channels: ["gateway", "web"],
    safeScopes: ["bridge-safe"],
    activityDescription: "Capture a screenshot from the active browser page",
    resultSchema: {
        kind: "text",
        description: "Screenshot file path text.",
    },
    outputPersistencePolicy: "artifact",
});

export const browserGetContentTool: Tool = withToolContract({
    definition: {
        name: "browser_get_content",
        description: "Get the content of the active page in Markdown (default), Text, or HTML format. Use 'markdown' for reading articles.",
        parameters: {
            type: "object",
            properties: {
                format: {
                    type: "string",
                    description: "Format to return: 'markdown' (optimized for reading), 'text' (raw text), or 'html' (raw source). Default is 'markdown'.",
                    enum: ["markdown", "text", "html"]
                },
            },
        },
    },
    execute: async (args, context) => {
        const start = Date.now();
        try {
            throwIfAborted(context.abortSignal);
            const format = (args.format as string) || "markdown";
            const manager = BrowserManager.getInstance();
            const page = await manager.getPage(context.abortSignal);

            let content = "";

            try {
                await raceWithAbort(page.waitForFunction(
                    () => (document.body?.innerText ?? "").trim().length > 120,
                    { timeout: 1500 }
                ), context.abortSignal);
            } catch (error) {
                if (context.abortSignal?.aborted) {
                    throw error;
                }
            }

            if (format === "html") {
                throwIfAborted(context.abortSignal);
                content = await page.content();
            } else if (format === "text") {
                throwIfAborted(context.abortSignal);
                content = await page.evaluate(() => document.body.innerText);
            } else {
                // Markdown (Readability)
                throwIfAborted(context.abortSignal);
                const html = await page.content();
                const url = page.url();
                const pageInfo = await page.evaluate(() => ({
                    title: document.title,
                    bodyText: document.body?.innerText ?? "",
                }));
                // Ensure import works in ESM context
                const { extractBestContent, htmlToMarkdown } = await import("./utils.js");

                try {
                    const result = extractBestContent({
                        html,
                        url,
                        title: pageInfo.title,
                        bodyText: pageInfo.bodyText,
                    });

                    if (result) {
                        const title = result.title ? `# ${result.title}\n\n` : "";
                        const byline = result.byline ? `*By ${result.byline}*\n\n` : "";
                        const originalUrl = `*Source: ${url}*\n\n`;
                        content = `${title}${byline}${originalUrl}${result.content}`;
                    } else {
                        // Fallback if readability fails
                        content = pageInfo.bodyText || htmlToMarkdown(html);
                    }
                } catch (e) {
                    browserLogger?.warn("Structured extraction failed, falling back to raw markdown conversion", e);
                    content = pageInfo.bodyText || htmlToMarkdown(html);
                }
            }

            // Truncate to avoid context overflow (adjustable)
            const MAX_LEN = 15000;
            const truncated = content.length > MAX_LEN
                ? content.slice(0, MAX_LEN) + `\n\n...[content truncated, original length: ${content.length} chars]...`
                : content;

            return success("unknown", "browser_get_content", truncated, start, {
                pageUrl: typeof page.url === "function" ? page.url() : undefined,
                format,
            });
        } catch (err) {
            return failure("unknown", "browser_get_content", err, start);
        }
    },
}, {
    family: "browser",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: true,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["bridge-safe"],
    activityDescription: "Read content from the active browser page",
    resultSchema: {
        kind: "text",
        description: "Page content in markdown, text, or HTML format.",
    },
    outputPersistencePolicy: "conversation",
});

export const browserSnapshotTool: Tool = withToolContract({
    definition: {
        name: "browser_snapshot",
        description: "Capture an interactive DOM snapshot of the active page. This returns a compressed text representation of the page, filtering out noise and assigning numeric IDs (e.g. [42]) to interactive elements.",
        parameters: {
            type: "object",
            properties: {},
        },
    },
    execute: async (args, context) => {
        const start = Date.now();
        try {
            throwIfAborted(context.abortSignal);
            const manager = BrowserManager.getInstance();
            const page = await manager.getPage(context.abortSignal);

            // Inject and execute the snapshot script
            throwIfAborted(context.abortSignal);
            const snapshot = await page.evaluate((script) => {
                // Execute the script string
                return eval(script);
            }, SNAPSHOT_SCRIPT);

            return success("unknown", "browser_snapshot", String(snapshot), start);
        } catch (err) {
            return failure("unknown", "browser_snapshot", err, start);
        }
    },
}, {
    family: "browser",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: true,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["bridge-safe"],
    activityDescription: "Capture an interactive DOM snapshot of the active page",
    resultSchema: {
        kind: "text",
        description: "Compressed DOM snapshot text with interactive element IDs.",
    },
    outputPersistencePolicy: "conversation",
});
