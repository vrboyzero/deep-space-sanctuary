const HANDOFF_PARAM = "authHandoff";
const HANDOFF_STORAGE_PREFIX = "belldandy.webchat.authHandoff.";
const HANDOFF_CHANNEL_PREFIX = "belldandy.webchat.authHandoff.channel.";
const HANDOFF_MAX_AGE_MS = 60 * 1000;
const activeHandoffs = new Map();
const activeHandoffReceivers = new Set();
let disposed = false;

function safeLocalStorageRead(readFn) {
  try {
    return readFn(globalThis.localStorage);
  } catch {
    return undefined;
  }
}

function safeLocalStorageWrite(writeFn) {
  try {
    writeFn(globalThis.localStorage);
  } catch {
    // ignore storage failures
  }
}

function buildUrlWithHandoff(currentUrl, handoffId) {
  const base = globalThis.location?.href || "http://127.0.0.1/";
  const nextUrl = new URL(currentUrl || base, base);
  nextUrl.searchParams.set(HANDOFF_PARAM, handoffId);
  return nextUrl.toString();
}

function stripHandoffParam(currentLocation, currentHistory) {
  try {
    const params = new URLSearchParams(currentLocation.search);
    if (!params.has(HANDOFF_PARAM)) return;
    params.delete(HANDOFF_PARAM);
    const query = params.toString();
    const nextUrl = `${currentLocation.pathname}${query ? `?${query}` : ""}${currentLocation.hash || ""}`;
    currentHistory?.replaceState?.({}, "", nextUrl);
  } catch {
    // ignore URL rewrite failures
  }
}

function clearLegacyHandoffStorage(exceptKey = "") {
  safeLocalStorageWrite((storage) => {
    const keys = [];
    for (let index = 0; index < Number(storage.length || 0); index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(HANDOFF_STORAGE_PREFIX) && key !== exceptKey) {
        keys.push(key);
      }
    }
    for (const key of keys) storage.removeItem(key);
  });
}

function closeActiveHandoff(handoffId) {
  const active = activeHandoffs.get(handoffId);
  if (!active) return;
  activeHandoffs.delete(handoffId);
  clearTimeout(active.timeoutHandle);
  active.channel.removeEventListener?.("message", active.handleMessage);
  active.channel.close();
}

function createSecureHandoffId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // 安全随机源不可用时禁用 handoff，不回退到 Math.random。
  }
  return "";
}

function createInMemoryHandoff({ handoffId, mode, value, createdAt }) {
  if (disposed) return false;
  const BroadcastChannelCtor = globalThis.BroadcastChannel;
  if (typeof BroadcastChannelCtor !== "function") return false;

  closeActiveHandoff(handoffId);
  let channel;
  try {
    channel = new BroadcastChannelCtor(`${HANDOFF_CHANNEL_PREFIX}${handoffId}`);
  } catch {
    return false;
  }
  let delivered = false;
  const handleMessage = (event) => {
    const request = event?.data;
    if (request?.handoffId !== handoffId) return;
    if (request.type === "received" && delivered) {
      closeActiveHandoff(handoffId);
      return;
    }
    if (request.type !== "request" || delivered) return;
    delivered = true;
    channel.postMessage({ type: "credential", handoffId, mode, value, createdAt });
  };
  const timeoutHandle = setTimeout(() => closeActiveHandoff(handoffId), HANDOFF_MAX_AGE_MS);
  timeoutHandle?.unref?.();
  activeHandoffs.set(handoffId, { channel, handleMessage, timeoutHandle });
  channel.addEventListener("message", handleMessage);
  return true;
}

function normalizeHandoffPayload(payload, { handoffId, now, maxAgeMs }) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.handoffId && payload.handoffId !== handoffId) return null;
  const mode = typeof payload.mode === "string" ? payload.mode.trim() : "";
  const value = typeof payload.value === "string" ? payload.value.trim() : "";
  const createdAt = Number(payload.createdAt);
  if (mode !== "token" || !value) return null;
  if (!Number.isFinite(createdAt) || now - createdAt > maxAgeMs) return null;
  return { mode, value };
}

function requestInMemoryHandoff({ handoffId, now, maxAgeMs, waitMs }) {
  if (disposed) return Promise.resolve(null);
  const BroadcastChannelCtor = globalThis.BroadcastChannel;
  if (typeof BroadcastChannelCtor !== "function") return Promise.resolve(null);

  let channel;
  try {
    channel = new BroadcastChannelCtor(`${HANDOFF_CHANNEL_PREFIX}${handoffId}`);
  } catch {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const receiver = {
      channel,
      closeTimer: null,
      handleMessage: null,
      listenerBound: false,
      settled: false,
      waitTimer: null,
      dispose: null,
    };

    const closeReceiver = () => {
      if (!activeHandoffReceivers.has(receiver)) return;
      activeHandoffReceivers.delete(receiver);
      if (receiver.waitTimer !== null) {
        clearTimeout(receiver.waitTimer);
        receiver.waitTimer = null;
      }
      if (receiver.closeTimer !== null) {
        clearTimeout(receiver.closeTimer);
        receiver.closeTimer = null;
      }
      if (receiver.listenerBound) {
        channel.removeEventListener?.("message", receiver.handleMessage);
        receiver.listenerBound = false;
      }
      channel.close();
    };

    const finish = (value, closeDelayMs = 0) => {
      if (receiver.settled) return;
      receiver.settled = true;
      if (receiver.waitTimer !== null) {
        clearTimeout(receiver.waitTimer);
        receiver.waitTimer = null;
      }
      if (receiver.listenerBound) {
        channel.removeEventListener?.("message", receiver.handleMessage);
        receiver.listenerBound = false;
      }
      if (closeDelayMs > 0 && !disposed) {
        receiver.closeTimer = setTimeout(closeReceiver, closeDelayMs);
        receiver.closeTimer?.unref?.();
      } else {
        closeReceiver();
      }
      resolve(value);
    };

    receiver.dispose = () => {
      if (!receiver.settled) {
        receiver.settled = true;
        resolve(null);
      }
      closeReceiver();
    };
    receiver.handleMessage = (event) => {
      const payload = event?.data;
      if (payload?.type !== "credential") return;
      const normalized = normalizeHandoffPayload(payload, { handoffId, now, maxAgeMs });
      if (normalized) {
        channel.postMessage({ type: "received", handoffId });
        finish(normalized, 50);
      }
    };
    receiver.listenerBound = true;
    channel.addEventListener("message", receiver.handleMessage);
    activeHandoffReceivers.add(receiver);
    receiver.waitTimer = setTimeout(() => finish(null), Math.max(0, Number(waitMs) || 0));
    receiver.waitTimer?.unref?.();
    try {
      channel.postMessage({ type: "request", handoffId });
    } catch {
      finish(null);
    }
  });
}

export function disposeSessionAuthHandoffs() {
  if (disposed) return;
  disposed = true;
  for (const handoffId of [...activeHandoffs.keys()]) closeActiveHandoff(handoffId);
  for (const receiver of [...activeHandoffReceivers]) receiver.dispose();
}

export function getSessionAuthHandoffRuntimeSnapshot() {
  let pendingConsumerCount = 0;
  let delayedCloseCount = 0;
  let receiverListenerCount = 0;
  let receiverTimerCount = 0;
  for (const receiver of activeHandoffReceivers) {
    if (!receiver.settled) pendingConsumerCount += 1;
    if (receiver.closeTimer !== null) delayedCloseCount += 1;
    if (receiver.listenerBound) receiverListenerCount += 1;
    if (receiver.waitTimer !== null) receiverTimerCount += 1;
    if (receiver.closeTimer !== null) receiverTimerCount += 1;
  }
  return {
    activeProducerCount: activeHandoffs.size,
    pendingConsumerCount,
    delayedCloseCount,
    channelCount: activeHandoffs.size + activeHandoffReceivers.size,
    listenerCount: activeHandoffs.size + receiverListenerCount,
    timerCount: activeHandoffs.size + receiverTimerCount,
    disposed,
  };
}

export function createSessionAuthHandoffUrl({
  currentUrl = globalThis.location?.href || "/",
  authMode,
  authValue,
  now = Date.now(),
  idFactory,
} = {}) {
  const normalizedMode = typeof authMode === "string" ? authMode.trim() : "";
  const normalizedValue = typeof authValue === "string" ? authValue.trim() : "";
  if (normalizedMode !== "token" || !normalizedValue) {
    return currentUrl;
  }

  const handoffId = typeof idFactory === "function"
    ? String(idFactory()).trim()
    : createSecureHandoffId();
  if (!handoffId) return currentUrl;

  const created = createInMemoryHandoff({
    handoffId,
    mode: normalizedMode,
    value: normalizedValue,
    createdAt: now,
  });
  if (!created) return currentUrl;

  return buildUrlWithHandoff(currentUrl, handoffId);
}

export async function consumeSessionAuthHandoff({
  location = globalThis.location,
  history = globalThis.history,
  now = Date.now(),
  maxAgeMs = HANDOFF_MAX_AGE_MS,
  waitMs = 1500,
} = {}) {
  try {
    const params = new URLSearchParams(location?.search || "");
    const handoffId = params.get(HANDOFF_PARAM);
    const storageKey = handoffId ? `${HANDOFF_STORAGE_PREFIX}${handoffId}` : "";
    // 无论当前 URL 是否携带 nonce，都清理旧版本可能遗留的明文 handoff。
    clearLegacyHandoffStorage(storageKey);
    if (!handoffId) return null;

    const raw = safeLocalStorageRead((storage) => storage.getItem(storageKey));
    safeLocalStorageWrite((storage) => storage.removeItem(storageKey));
    stripHandoffParam(location, history);
    if (disposed) return null;

    if (raw) {
      const legacyPayload = normalizeHandoffPayload(JSON.parse(raw), { handoffId, now, maxAgeMs });
      if (legacyPayload) return legacyPayload;
    }
    return await requestInMemoryHandoff({ handoffId, now, maxAgeMs, waitMs });
  } catch {
    return null;
  }
}
