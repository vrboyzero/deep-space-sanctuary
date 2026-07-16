const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const SOCKET_CLOSED = 3;

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 2_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_JITTER_RATIO = 0.2;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

function asPositiveInteger(value, fallback) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function asError(value, fallbackMessage) {
    if (value instanceof Error) {
        return value;
    }
    if (typeof value?.message === "string" && value.message) {
        return new Error(value.message);
    }
    return new Error(fallbackMessage);
}

function closeSocket(socket) {
    if (!socket || socket.readyState === SOCKET_CLOSING || socket.readyState === SOCKET_CLOSED) {
        return;
    }
    try {
        socket.close();
    } catch {
        // 迟到事件到达控制器时，WebSocket 可能已经处于关闭过程中。
    }
}

/**
 * 管理扩展侧 Relay 连接，避免 MV3 worker 生命周期内累积 socket、timer 或 Chrome debugger listener。
 */
export class RelayConnectionController {
    #activeAttempt = null;
    #attachDebuggerListeners;
    #connectPromise = null;
    #connectTimeoutMs;
    #createSocket;
    #debuggerListenersAttached = false;
    #detachDebuggerListeners;
    #disposed = false;
    #generation = 0;
    #getConfig;
    #maxReconnectAttempts;
    #onMessage;
    #onStateChange;
    #random;
    #reconnectAttempts = 0;
    #reconnectBaseDelayMs;
    #reconnectJitterRatio;
    #reconnectMaxDelayMs;
    #reconnectTimer = null;
    #setTimeout;
    #clearTimeout;
    #socket = null;

    constructor({
        getConfig,
        createSocket,
        attachDebuggerListeners = () => {},
        detachDebuggerListeners = () => {},
        onMessage = () => {},
        onStateChange = () => {},
        connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
        reconnectBaseDelayMs = DEFAULT_RECONNECT_BASE_DELAY_MS,
        reconnectMaxDelayMs = DEFAULT_RECONNECT_MAX_DELAY_MS,
        reconnectJitterRatio = DEFAULT_RECONNECT_JITTER_RATIO,
        maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
        setTimeoutFn = globalThis.setTimeout.bind(globalThis),
        clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
        random = Math.random,
    } = {}) {
        if (typeof getConfig !== "function" || typeof createSocket !== "function") {
            throw new TypeError("RelayConnectionController requires getConfig and createSocket functions.");
        }

        this.#getConfig = getConfig;
        this.#createSocket = createSocket;
        this.#attachDebuggerListeners = attachDebuggerListeners;
        this.#detachDebuggerListeners = detachDebuggerListeners;
        this.#onMessage = onMessage;
        this.#onStateChange = onStateChange;
        this.#connectTimeoutMs = asPositiveInteger(connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
        this.#reconnectBaseDelayMs = asPositiveInteger(reconnectBaseDelayMs, DEFAULT_RECONNECT_BASE_DELAY_MS);
        this.#reconnectMaxDelayMs = Math.max(
            this.#reconnectBaseDelayMs,
            asPositiveInteger(reconnectMaxDelayMs, DEFAULT_RECONNECT_MAX_DELAY_MS),
        );
        this.#reconnectJitterRatio = Math.min(
            1,
            Math.max(0, Number.isFinite(reconnectJitterRatio) ? reconnectJitterRatio : DEFAULT_RECONNECT_JITTER_RATIO),
        );
        this.#maxReconnectAttempts = Number.isFinite(maxReconnectAttempts)
            ? Math.max(0, Math.floor(maxReconnectAttempts))
            : Number.POSITIVE_INFINITY;
        this.#setTimeout = setTimeoutFn;
        this.#clearTimeout = clearTimeoutFn;
        this.#random = random;
    }

    start() {
        if (this.#disposed) {
            return Promise.reject(new Error("Relay connection controller has been disposed."));
        }
        if (this.#socket?.readyState === SOCKET_OPEN) {
            return Promise.resolve();
        }
        if (this.#connectPromise) {
            return this.#connectPromise;
        }

        this.#clearReconnectTimer();
        return this.#beginConnection();
    }

    forceReconnect() {
        if (this.#disposed) {
            return Promise.reject(new Error("Relay connection controller has been disposed."));
        }

        this.#clearReconnectTimer();
        this.#reconnectAttempts = 0;
        this.#cancelActiveAttempt(new Error("Relay connection was replaced by a forced reconnect."));
        return this.#beginConnection();
    }

    send(message) {
        if (!this.#socket || this.#socket.readyState !== SOCKET_OPEN) {
            return false;
        }

        try {
            const payload = typeof message === "string" ? message : JSON.stringify(message);
            if (typeof payload !== "string") {
                return false;
            }
            this.#socket.send(payload);
            return true;
        } catch (error) {
            this.#emitState("send-error", { error: asError(error, "Relay send failed.") });
            return false;
        }
    }

    dispose() {
        if (this.#disposed) {
            return;
        }

        this.#disposed = true;
        this.#clearReconnectTimer();
        this.#cancelActiveAttempt(new Error("Relay connection controller was disposed."));

        if (this.#debuggerListenersAttached) {
            this.#debuggerListenersAttached = false;
            try {
                this.#detachDebuggerListeners();
            } catch {
                // MV3 worker 即将挂起时，listener 移除采用尽力而为策略。
            }
        }

        this.#emitState("disposed");
    }

    #beginConnection() {
        const attempt = {
            generation: ++this.#generation,
            promise: null,
            reject: null,
            resolve: null,
            settled: false,
            socket: null,
            timeout: null,
        };
        const promise = new Promise((resolve, reject) => {
            attempt.resolve = resolve;
            attempt.reject = reject;
        });
        attempt.promise = promise;
        this.#activeAttempt = attempt;
        this.#connectPromise = promise;

        // 强制重连可能拒绝已被替换的调用方；保留处理器但不改变原 Promise 的结果。
        void promise.catch(() => {});
        this.#emitState("connecting", { generation: attempt.generation });
        void this.#openSocket(attempt);
        return promise;
    }

    async #openSocket(attempt) {
        try {
            const { port, token } = await this.#getConfig();
            if (!this.#isCurrent(attempt)) {
                return;
            }

            const socket = this.#createSocket(
                "ws://127.0.0.1:" + port + "/extension",
                ["belldandy-relay-v1." + token],
            );
            if (!this.#isCurrent(attempt)) {
                closeSocket(socket);
                return;
            }

            attempt.socket = socket;
            this.#socket = socket;
            socket.onopen = () => this.#handleOpen(attempt);
            socket.onerror = (event) => this.#handleError(attempt, event);
            socket.onclose = () => this.#handleClose(attempt);
            socket.onmessage = (event) => this.#handleMessage(attempt, event.data);
            attempt.timeout = this.#setTimeout(
                () => this.#handleError(attempt, new Error("Relay connection timed out.")),
                this.#connectTimeoutMs,
            );
        } catch (error) {
            this.#handleError(attempt, error);
        }
    }

    #handleOpen(attempt) {
        if (!this.#isCurrent(attempt)) {
            closeSocket(attempt.socket);
            return;
        }

        if (!this.#debuggerListenersAttached) {
            try {
                this.#attachDebuggerListeners();
                this.#debuggerListenersAttached = true;
            } catch (error) {
                this.#handleError(attempt, error);
                return;
            }
        }

        this.#clearAttemptTimeout(attempt);
        attempt.settled = true;
        this.#connectPromise = null;
        this.#reconnectAttempts = 0;
        attempt.resolve();
        this.#emitState("connected", { generation: attempt.generation });
    }

    #handleError(attempt, event) {
        if (!this.#isCurrent(attempt)) {
            return;
        }

        const error = asError(event, "Relay connection failed.");
        const wasConnected = attempt.settled;
        const socket = attempt.socket;
        this.#releaseAttempt(attempt);
        if (!wasConnected) {
            attempt.reject(error);
        }
        this.#emitState("error", { error, generation: attempt.generation });
        closeSocket(socket);
        this.#scheduleReconnect();
    }

    #handleClose(attempt) {
        if (!this.#isCurrent(attempt)) {
            return;
        }

        const wasConnected = attempt.settled;
        this.#releaseAttempt(attempt);
        if (!wasConnected) {
            attempt.reject(new Error("Relay connection closed before opening."));
        }
        this.#emitState("disconnected", { generation: attempt.generation });
        this.#scheduleReconnect();
    }

    #handleMessage(attempt, data) {
        if (!this.#isCurrent(attempt)) {
            return;
        }

        try {
            const result = this.#onMessage(data);
            Promise.resolve(result).catch((error) => {
                this.#emitState("message-error", { error: asError(error, "Relay message handling failed.") });
            });
        } catch (error) {
            this.#emitState("message-error", { error: asError(error, "Relay message handling failed.") });
        }
    }

    #scheduleReconnect() {
        if (this.#disposed || this.#reconnectTimer !== null) {
            return;
        }
        if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
            this.#emitState("reconnect-exhausted", { attempts: this.#reconnectAttempts });
            return;
        }

        const retryNumber = this.#reconnectAttempts;
        const cappedDelay = Math.min(
            this.#reconnectMaxDelayMs,
            this.#reconnectBaseDelayMs * (2 ** Math.min(retryNumber, 30)),
        );
        const jitter = cappedDelay * this.#reconnectJitterRatio * ((this.#random() * 2) - 1);
        const delayMs = Math.max(0, Math.round(cappedDelay + jitter));
        this.#reconnectAttempts += 1;
        this.#reconnectTimer = this.#setTimeout(() => {
            this.#reconnectTimer = null;
            if (this.#disposed || this.#socket || this.#connectPromise) {
                return;
            }
            void this.start().catch(() => {});
        }, delayMs);
        this.#emitState("reconnecting", {
            attempts: this.#reconnectAttempts,
            delayMs,
        });
    }

    #cancelActiveAttempt(error) {
        const attempt = this.#activeAttempt;
        if (!attempt) {
            return;
        }

        const socket = attempt.socket;
        const wasConnected = attempt.settled;
        this.#releaseAttempt(attempt);
        if (!wasConnected) {
            attempt.reject(error);
        }
        closeSocket(socket);
    }

    #releaseAttempt(attempt) {
        this.#clearAttemptTimeout(attempt);
        if (this.#activeAttempt === attempt) {
            this.#activeAttempt = null;
        }
        if (this.#socket === attempt.socket) {
            this.#socket = null;
        }
        if (this.#connectPromise === attempt.promise) {
            this.#connectPromise = null;
        }
    }

    #clearAttemptTimeout(attempt) {
        if (attempt.timeout !== null) {
            this.#clearTimeout(attempt.timeout);
            attempt.timeout = null;
        }
    }

    #clearReconnectTimer() {
        if (this.#reconnectTimer !== null) {
            this.#clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
    }

    #isCurrent(attempt) {
        return !this.#disposed
            && this.#activeAttempt === attempt
            && this.#generation === attempt.generation;
    }

    #emitState(state, detail = {}) {
        try {
            this.#onStateChange(state, detail);
        } catch {
            // UI 诊断回调不能破坏 socket 生命周期。
        }
    }
}
