const DEFAULT_PORT = 28892;

/** @type {WebSocket|null} */
let relayWs = null;
/** @type {Promise<void>|null} */
let relayConnectPromise = null;

// 存储 Tab 与 Session 的映射
const tabs = new Map(); // tabId -> { sessionId, targetId, state }
const tabBySession = new Map(); // sessionId -> tabId

// =========================================
// KEEP-ALIVE: 防止 MV3 Service Worker 被挂起
// =========================================
const KEEP_ALIVE_ALARM_NAME = "belldandy-keepalive";
const KEEP_ALIVE_INTERVAL_MINUTES = 0.4; // ~24 秒，低于 30 秒挂起阈值

// 使用 Chrome Alarms API 保持 Service Worker 活跃
chrome.alarms.create(KEEP_ALIVE_ALARM_NAME, {
    periodInMinutes: KEEP_ALIVE_INTERVAL_MINUTES
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM_NAME) {
        // 发送心跳 ping 保持 WebSocket 连接
        if (relayWs && relayWs.readyState === WebSocket.OPEN) {
            relayWs.send(JSON.stringify({ method: "ping" }));
            console.log("[Star Sanctuary] Keep-alive ping sent");
        }
    }
});

async function getRelayConfig() {
    const stored = await chrome.storage.local.get(['relayPort', 'relayToken']);
    const n = parseInt(stored.relayPort, 10);
    const port = (Number.isFinite(n) && n > 0 && n <= 65535) ? n : DEFAULT_PORT;
    const token = typeof stored.relayToken === 'string' ? stored.relayToken.trim() : '';
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
        throw new Error("Relay credential is missing or invalid. Open extension options to configure it.");
    }
    return { port, token };
}

// 连接到 Relay Server
async function ensureRelayConnection() {
    // 【修复】检查 WebSocket 状态，如果已关闭或正在关闭，清理引用
    if (relayWs) {
        if (relayWs.readyState === WebSocket.OPEN) {
            return; // 已连接，无需操作
        }
        if (relayWs.readyState === WebSocket.CLOSING || relayWs.readyState === WebSocket.CLOSED) {
            console.log("[Star Sanctuary] Cleaning up closed WebSocket");
            relayWs = null;
        }
    }

    if (relayConnectPromise) return await relayConnectPromise;

    relayConnectPromise = (async () => {
        const { port, token } = await getRelayConfig();
        const wsUrl = `ws://127.0.0.1:${port}/extension`;
        const relayProtocol = `belldandy-relay-v1.${token}`;

        console.log(`[Star Sanctuary] Connecting to Relay on port ${port}...`);
        setBadge("...", "#2196F3"); // Blue

        try {
            const ws = new WebSocket(wsUrl, [relayProtocol]);
            relayWs = ws;

            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error("Timeout")), 5000);
                ws.onopen = () => {
                    clearTimeout(t);
                    console.log("[Star Sanctuary] Relay Connected");
                    setBadge("ON", "#4CAF50"); // Green
                    resolve();
                };
                ws.onerror = () => {
                    clearTimeout(t);
                    console.error("[Star Sanctuary] Connection Failed");
                    setBadge("ERR", "#F44336"); // Red
                    reject(new Error("Connection Failed"));
                };
            });

            ws.onmessage = (event) => onRelayMessage(event.data);
            ws.onclose = () => {
                console.log("[Star Sanctuary] Relay Disconnected");
                setBadge("OFF", "#F44336"); // Red
                relayWs = null;
            };

            // 监听 Debugger 事件
            chrome.debugger.onEvent.addListener(onDebuggerEvent);
            chrome.debugger.onDetach.addListener(onDebuggerDetach);
        } catch (err) {
            console.error("[Star Sanctuary] Connection Error:", err);
            relayWs = null;
            throw err;
        } finally {
            relayConnectPromise = null;
        }
    })();

    return relayConnectPromise;
}

// 处理来自 Relay 的消息
async function onRelayMessage(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.method === "ping") {
        relayWs?.send(JSON.stringify({ method: "pong" }));
        return;
    }

    if (msg.method === "forwardCDPCommand" && msg.params) {
        const { method, params, sessionId } = msg.params;
        const id = msg.id;

        try {
            const result = await handleCdpCommand(method, params, sessionId);
            relayWs?.send(JSON.stringify({ id, result }));
        } catch (err) {
            relayWs?.send(JSON.stringify({ id, error: err.message }));
        }
    }
}

// =========================================
// PROTECTED TABS: 保护 WebChat 等关键页面不被导航替换
// =========================================
const PROTECTED_URL_PATTERNS = [
    /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/,  // Gateway WebChat (any port)
    /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/webchat/i,  // WebChat 路径
    /belldandy/i  // 任何包含 belldandy 的 URL
];

async function isProtectedTab(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.url) return false;
        return PROTECTED_URL_PATTERNS.some(pattern => pattern.test(tab.url));
    } catch {
        return false;
    }
}

// 执行 CDP 指令
async function handleCdpCommand(method, params, sessionId) {
    // 判断是否是导航类命令
    const isNavigationCommand = method === "Page.navigate" || method === "Page.navigateToHistoryEntry";

    // 1. 查找目标 Tab
    let tabId;
    if (sessionId) {
        tabId = tabBySession.get(sessionId);
        // 【关键修复】如果有 sessionId 但找不到对应 tab，对于导航命令直接报错
        // 不要回退到 active tab，避免替换 WebChat
        if (!tabId && isNavigationCommand) {
            console.error(`[Star Sanctuary] Session ${sessionId} not found for navigation command`);
            throw new Error(`Session ${sessionId} not found. Cannot fallback to active tab for navigation.`);
        }
    }

    // 如果没有找到 tabId，尝试使用 active tab（仅限非导航命令）
    if (!tabId) {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (active) {
            // 【保护检查】对于导航命令，绝不使用受保护的标签页
            if (isNavigationCommand && await isProtectedTab(active.id)) {
                console.warn(`[Star Sanctuary] BLOCKED: Active tab ${active.id} is protected, refusing to navigate`);
                throw new Error("Cannot navigate: active tab is protected (WebChat). Use browser_open to create a new tab.");
            }
            tabId = active.id;
        }
    }

    // 【双重保护】即使通过 session 找到了 tabId，也再检查一次
    if (tabId && isNavigationCommand) {
        if (await isProtectedTab(tabId)) {
            console.warn(`[Star Sanctuary] BLOCKED: Refusing to navigate protected tab ${tabId}`);
            throw new Error("Cannot navigate protected tab (WebChat). Use browser_open to create a new tab instead.");
        }
    }

    if (!tabId) throw new Error("No target tab found");

    // special case: Target.createTarget
    if (method === "Target.createTarget") {
        const url = params?.url || "about:blank";
        const tab = await chrome.tabs.create({ url, active: false });
        const newTabId = tab.id;

        // 【关键修复】创建标签页后立即 attach 并设置 session 映射
        // 这样后续的 navigate 命令才能找到正确的标签页
        try {
            await chrome.debugger.attach({ tabId: newTabId }, "1.3");
            const newSessionId = `session-${newTabId}-${Date.now()}`;

            tabs.set(newTabId, { sessionId: newSessionId, targetId: String(newTabId), state: "attached" });
            tabBySession.set(newSessionId, newTabId);

            // 通知 Relay 新标签页已连接
            sendEventToRelay("Target.attachedToTarget", {
                sessionId: newSessionId,
                targetInfo: {
                    targetId: String(newTabId),
                    type: "page",
                    url: url,
                    title: "New Tab",
                    attached: true,
                    browserContextId: "default-context"
                },
                waitingForDebugger: false
            });

            console.log(`[Star Sanctuary] Created and attached to new tab ${newTabId} with session ${newSessionId}`);
        } catch (attachErr) {
            console.warn(`[Star Sanctuary] Failed to auto-attach to new tab ${newTabId}:`, attachErr.message);
        }

        // NOTE: Puppeteer expects { targetId }
        return { targetId: String(newTabId) };
    }

    // special case: Target.attachToTarget
    if (method === "Target.attachToTarget") {
        const targetIdStr = params?.targetId;
        const flatten = params?.flatten; // Puppeteer uses flatten:true

        let tabId;
        if (targetIdStr === "page-1") {
            // Resolve "page-1" alias to current active tab
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!active) throw new Error("No active tab found for alias page-1");
            tabId = active.id;
        } else {
            tabId = parseInt(targetIdStr, 10);
        }

        if (!tabId || isNaN(tabId)) throw new Error(`Invalid targetId: ${targetIdStr}`);

        // Check if already attached
        let existingInfo = tabs.get(tabId);
        if (existingInfo && existingInfo.state === "attached") {
            // Re-emit event for new clients (like Puppeteer) who need to see the attachment happen
            // especially if they are asking for an alias like "page-1"
            sendEventToRelay("Target.attachedToTarget", {
                sessionId: existingInfo.sessionId,
                targetInfo: {
                    targetId: targetIdStr, // Use "page-1" if that was requested
                    type: "page",
                    url: "",
                    title: "",
                    attached: true
                },
                waitingForDebugger: false
            });
            return { sessionId: existingInfo.sessionId };
        }

        await chrome.debugger.attach({ tabId }, "1.3");
        const newSessionId = `session-${tabId}-${Date.now()}`;

        tabs.set(tabId, { sessionId: newSessionId, targetId: String(tabId), state: "attached" });
        tabBySession.set(newSessionId, tabId);

        // Required by Puppeteer to confirm attachment
        // CRITICAL: We must use the SAME targetId that Puppeteer used to request attachment
        // otherwise Puppeteer won't recognize this session belongs to the target it just discovered.
        sendEventToRelay("Target.attachedToTarget", {
            sessionId: newSessionId,
            targetInfo: {
                targetId: targetIdStr, // Use "page-1" if that was requested
                type: "page",
                url: "",
                title: "",
                attached: true
            },
            waitingForDebugger: false
        });

        return { sessionId: newSessionId };
    }

    // special case: Target.closeTarget
    if (method === "Target.closeTarget") {
        const targetIdStr = params?.targetId;
        const tabId = parseInt(targetIdStr, 10);
        if (tabId) {
            await chrome.tabs.remove(tabId);
            return { success: true };
        }
    }

    // 2. 确保已 Attach
    // 如果是普通指令（非 attach/create），必须基于 session 或 tabId
    // ... logic continues ...
    let tabInfo = tabs.get(tabId);
    if (!tabInfo) {
        // Auto-attach if missing (fallback for direct commands)
        // ... (existing auto-attach logic) ...

        await chrome.debugger.attach({ tabId }, "1.3");
        const generatedSessionId = `session-${tabId}-${Date.now()}`;
        tabInfo = { sessionId: generatedSessionId, targetId: String(tabId), state: "attached" };
        tabs.set(tabId, tabInfo);
        tabBySession.set(generatedSessionId, tabId);

        // 通知 Relay 已连接
        sendEventToRelay("Target.attachedToTarget", {
            sessionId: generatedSessionId,
            targetInfo: { targetId: String(tabId), type: "page", url: "", title: "", attached: true },
            waitingForDebugger: false
        });
    }

    // 3. 发送指令
    const debuggee = { tabId };
    // 注意：如果有 sessionId，chrome.debugger.sendCommand 不需要传 sessionId 参数给 Chrome，
    // 因为 debuggee 对象中的 tabId 已经确定了目标。
    // 但是如果是 Flat 模式（Target.attachToTarget 后的子 Session），则需要 extensionId? 不，chrome.debugger 不支持 raw session ID。
    // Chrome Extension Debugger API 是基于 tabId 的。
    // Moltbot 的实现比较复杂，处理了 Target.attachToTarget。
    // 简化版：我们只支持直接控制 Tab。

    return await chrome.debugger.sendCommand(debuggee, method, params);
}

// 转发 Debugger 事件给 Relay
function onDebuggerEvent(source, method, params) {
    const tabId = source.tabId;
    const tabInfo = tabs.get(tabId);
    const sessionId = tabInfo?.sessionId;

    sendEventToRelay(method, params, sessionId);
}

function onDebuggerDetach(source, reason) {
    const tabId = source.tabId;
    const tabInfo = tabs.get(tabId);
    if (tabInfo) {
        sendEventToRelay("Target.detachedFromTarget", { sessionId: tabInfo.sessionId }, tabInfo.sessionId);
        tabs.delete(tabId);
        tabBySession.delete(tabInfo.sessionId);
    }
}

function sendEventToRelay(method, params, sessionId) {
    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
        relayWs.send(JSON.stringify({
            method: "forwardCDPEvent",
            params: { method, params, sessionId }
        }));
    }
}

// 状态指示器
function setBadge(text, color) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
}

// 初始化状态
setBadge("OFF", "#F44336");

// 点击图标时连接
chrome.action.onClicked.addListener(async () => {
    console.log("[Star Sanctuary] User clicked action icon. Forcing reconnection...");

    // 强制清理现有连接
    if (relayWs) {
        try { relayWs.close(); } catch (e) { }
        relayWs = null;
    }
    relayConnectPromise = null;

    // 尝试重连
    try {
        await ensureRelayConnection();
        // 主动 attach 当前 tab
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (active) {
            handleCdpCommand("Page.enable", {}, null); // 触发 attach 逻辑
        }
    } catch (e) {
        console.error("Manual connection failed:", e);
        setBadge("ERR", "#F44336");
        if (String(e?.message || e).includes("credential")) {
            chrome.runtime.openOptionsPage();
        }
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || (!changes.relayPort && !changes.relayToken)) return;
    if (relayWs) {
        try { relayWs.close(); } catch { }
        relayWs = null;
    }
    autoConnectRetries = 0;
    void autoConnectToRelay();
});

// =========================================
// AUTO-CONNECT: 扩展启动时自动连接到 Relay
// =========================================
let autoConnectRetries = 0;
const MAX_AUTO_RETRIES = 10;
const AUTO_RETRY_DELAY = 3000; // 3 秒

async function autoConnectToRelay() {
    while (autoConnectRetries < MAX_AUTO_RETRIES) {
        try {
            await ensureRelayConnection();
            console.log("[Star Sanctuary] Auto-connect succeeded!");
            autoConnectRetries = 0; // 重置计数器
            return;
        } catch (err) {
            autoConnectRetries++;
            console.log(`[Star Sanctuary] Auto-connect attempt ${autoConnectRetries}/${MAX_AUTO_RETRIES} failed, retrying in ${AUTO_RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, AUTO_RETRY_DELAY));
        }
    }
    console.warn("[Star Sanctuary] Auto-connect exhausted all retries. Click the extension icon to connect manually.");
}

// 启动时尝试自动连接
autoConnectToRelay();

// 断开时自动重连
function setupAutoReconnect() {
    const originalOnClose = () => {
        console.log("[Star Sanctuary] Relay Disconnected, will auto-reconnect...");
        relayWs = null;
        // 延迟重连
        setTimeout(() => {
            autoConnectRetries = 0;
            autoConnectToRelay();
        }, 2000);
    };

    // Patch ensureRelayConnection to add reconnect listener
    const originalEnsure = ensureRelayConnection;
    ensureRelayConnection = async function () {
        await originalEnsure();
        if (relayWs && !relayWs._autoReconnectPatched) {
            relayWs._autoReconnectPatched = true;
            relayWs.addEventListener('close', originalOnClose);
        }
    };
}

setupAutoReconnect();

