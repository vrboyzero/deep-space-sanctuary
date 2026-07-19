function normalizeMessage(message, fallbackRole = "assistant") {
  if (!message || typeof message !== "object") return null;
  const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : fallbackRole;
  return {
    id: typeof message.id === "string" ? message.id : undefined,
    role,
    content: typeof message.content === "string" ? message.content : String(message.content ?? ""),
    timestampMs: typeof message.timestampMs === "number" && Number.isFinite(message.timestampMs)
      ? message.timestampMs
      : Date.now(),
    displayTimeText: typeof message.displayTimeText === "string" ? message.displayTimeText : "",
    isLatest: message.isLatest === true,
    agentId: typeof message.agentId === "string" ? message.agentId : undefined,
    __streaming: message.__streaming === true,
  };
}

function clearLatestFlags(items) {
  for (const item of items) {
    if (item) item.isLatest = false;
  }
}

const DEFAULT_MAX_CONVERSATION_ENTRIES = 24;
const DEFAULT_MAX_APPROX_BYTES = 4 * 1024 * 1024;
const DEFAULT_INACTIVE_TTL_MS = 30 * 60 * 1000;
const CONVERSATION_ENTRY_OVERHEAD_BYTES = 64;
const MESSAGE_OVERHEAD_BYTES = 128;

export function createAgentSessionCacheFeature(options = {}) {
  const agentConversationMap = new Map();
  const conversationMessagesCache = new Map();
  const conversationRetention = new Map();
  const maxConversationEntries = normalizeNonNegativeInteger(
    options.maxConversationEntries,
    DEFAULT_MAX_CONVERSATION_ENTRIES,
  );
  const maxApproxBytes = normalizeNonNegativeInteger(
    options.maxApproxBytes,
    DEFAULT_MAX_APPROX_BYTES,
  );
  const inactiveTtlMs = normalizeNonNegativeInteger(
    options.inactiveTtlMs,
    DEFAULT_INACTIVE_TTL_MS,
  );
  const now = typeof options.now === "function" ? options.now : Date.now;
  let activeConversationId = "";
  let retainedApproxBytes = 0;
  let evictedConversationCount = 0;
  let generationClearCount = 0;
  let disposed = false;

  function isStreamingConversation(conversationId) {
    const items = conversationMessagesCache.get(conversationId);
    return Array.isArray(items) && items.some((item) => item?.__streaming === true);
  }

  function touchConversation(conversationId) {
    const retention = conversationRetention.get(conversationId);
    if (!retention) return;
    retention.lastAccessedAt = now();
  }

  function deleteCachedConversation(conversationId, countEviction = true) {
    const retention = conversationRetention.get(conversationId);
    if (!retention) return false;
    retainedApproxBytes = Math.max(0, retainedApproxBytes - retention.approxBytes);
    conversationRetention.delete(conversationId);
    conversationMessagesCache.delete(conversationId);
    if (countEviction) evictedConversationCount += 1;
    return true;
  }

  function isOverBudget() {
    return conversationMessagesCache.size > maxConversationEntries
      || retainedApproxBytes > maxApproxBytes;
  }

  function pruneExpiredInactiveConversations(currentTime = now()) {
    for (const [conversationId, retention] of conversationRetention) {
      if (conversationId === activeConversationId || isStreamingConversation(conversationId)) continue;
      if (currentTime - retention.lastAccessedAt < inactiveTtlMs) continue;
      deleteCachedConversation(conversationId);
    }
  }

  function pruneConversationMessages() {
    pruneExpiredInactiveConversations();
    while (isOverBudget()) {
      const candidate = [...conversationRetention.entries()]
        .filter(([conversationId]) => (
          conversationId !== activeConversationId
          && !isStreamingConversation(conversationId)
        ))
        .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0];
      if (!candidate) return;

      // Binding ID 是可从服务端重载的导航状态，不随纯消息 cache 淘汰。
      deleteCachedConversation(candidate[0]);
    }
  }

  function writeConversationMessages(conversationId, items) {
    if (disposed || !conversationId) return;
    const previous = conversationRetention.get(conversationId);
    if (previous) {
      retainedApproxBytes = Math.max(0, retainedApproxBytes - previous.approxBytes);
    }
    const approxBytes = estimateConversationBytes(items);
    conversationMessagesCache.set(conversationId, items);
    conversationRetention.set(conversationId, {
      approxBytes,
      lastAccessedAt: now(),
    });
    retainedApproxBytes += approxBytes;
    pruneConversationMessages();
  }

  function bindAgentConversation(agentId, conversationId, options = {}) {
    if (disposed || !agentId || !conversationId) return;
    const existing = agentConversationMap.get(agentId) || {};
    const next = {
      mainConversationId: existing.mainConversationId || "",
      lastConversationId: existing.lastConversationId || "",
    };
    if (options.main) {
      next.mainConversationId = conversationId;
    }
    next.lastConversationId = conversationId;
    if (!next.mainConversationId) {
      next.mainConversationId = conversationId;
    }
    agentConversationMap.set(agentId, next);
  }

  function getAgentConversation(agentId) {
    if (disposed) return "";
    const entry = agentConversationMap.get(agentId);
    return entry?.lastConversationId || entry?.mainConversationId || "";
  }

  function setConversationMessages(conversationId, messages) {
    if (disposed || !conversationId) return;
    const normalized = Array.isArray(messages)
      ? messages.map((item) => normalizeMessage(item)).filter(Boolean)
      : [];
    clearLatestFlags(normalized);
    if (normalized.length > 0) {
      normalized[normalized.length - 1].isLatest = true;
    }
    writeConversationMessages(conversationId, normalized);
  }

  function getConversationMessages(conversationId) {
    if (disposed) return [];
    pruneExpiredInactiveConversations();
    const items = conversationMessagesCache.get(conversationId);
    if (Array.isArray(items)) touchConversation(conversationId);
    return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
  }

  function appendConversationMessage(conversationId, message) {
    if (!conversationId) return null;
    const normalized = normalizeMessage(message);
    if (!normalized) return null;
    const current = getConversationMessages(conversationId);
    clearLatestFlags(current);
    normalized.isLatest = true;
    current.push(normalized);
    writeConversationMessages(conversationId, current);
    return normalized;
  }

  function appendUserMessage(conversationId, content, meta = {}) {
    return appendConversationMessage(conversationId, {
      role: "user",
      content,
      timestampMs: meta.timestampMs,
      displayTimeText: meta.displayTimeText,
      isLatest: true,
      agentId: meta.agentId,
    });
  }

  function appendAssistantDelta(conversationId, delta, meta = {}) {
    if (!conversationId || !delta) return;
    const current = getConversationMessages(conversationId);
    const latest = current[current.length - 1];
    if (latest && latest.role === "assistant" && latest.__streaming === true) {
      latest.content += delta;
      if (typeof meta.timestampMs === "number") {
        latest.timestampMs = meta.timestampMs;
      }
      latest.isLatest = true;
      writeConversationMessages(conversationId, current);
      return;
    }

    clearLatestFlags(current);
    current.push({
      role: "assistant",
      content: delta,
      timestampMs: typeof meta.timestampMs === "number" ? meta.timestampMs : Date.now(),
      displayTimeText: typeof meta.displayTimeText === "string" ? meta.displayTimeText : "",
      isLatest: true,
      agentId: typeof meta.agentId === "string" ? meta.agentId : undefined,
      __streaming: true,
    });
    writeConversationMessages(conversationId, current);
  }

  function finalizeAssistantMessage(conversationId, content, meta = {}) {
    if (!conversationId) return;
    const current = getConversationMessages(conversationId);
    const latest = current[current.length - 1];
    clearLatestFlags(current);
    if (latest && latest.role === "assistant") {
      latest.content = typeof content === "string" ? content : String(content ?? "");
      latest.timestampMs = typeof meta.timestampMs === "number" ? meta.timestampMs : latest.timestampMs;
      latest.displayTimeText = typeof meta.displayTimeText === "string" ? meta.displayTimeText : latest.displayTimeText;
      latest.isLatest = true;
      latest.__streaming = false;
      writeConversationMessages(conversationId, current);
      return;
    }

    current.push({
      role: "assistant",
      content: typeof content === "string" ? content : String(content ?? ""),
      timestampMs: typeof meta.timestampMs === "number" ? meta.timestampMs : Date.now(),
      displayTimeText: typeof meta.displayTimeText === "string" ? meta.displayTimeText : "",
      isLatest: true,
      agentId: typeof meta.agentId === "string" ? meta.agentId : undefined,
      __streaming: false,
    });
    writeConversationMessages(conversationId, current);
  }

  function setActiveConversation(conversationId) {
    if (disposed) return;
    activeConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    if (activeConversationId) touchConversation(activeConversationId);
    pruneConversationMessages();
  }

  function clearGeneration() {
    if (disposed) return;
    agentConversationMap.clear();
    conversationMessagesCache.clear();
    conversationRetention.clear();
    activeConversationId = "";
    retainedApproxBytes = 0;
    generationClearCount += 1;
  }

  function dispose() {
    if (disposed) return;
    agentConversationMap.clear();
    conversationMessagesCache.clear();
    conversationRetention.clear();
    activeConversationId = "";
    retainedApproxBytes = 0;
    disposed = true;
  }

  function getRuntimeSnapshot() {
    const currentTime = now();
    pruneExpiredInactiveConversations(currentTime);
    let pendingConversationCount = 0;
    let oldestInactiveAgeMs = 0;
    for (const [conversationId, retention] of conversationRetention) {
      if (isStreamingConversation(conversationId)) {
        pendingConversationCount += 1;
      }
      if (conversationId !== activeConversationId) {
        oldestInactiveAgeMs = Math.max(
          oldestInactiveAgeMs,
          Math.max(0, currentTime - retention.lastAccessedAt),
        );
      }
    }
    return {
      retainedAgentBindingCount: agentConversationMap.size,
      retainedConversationCount: conversationMessagesCache.size,
      activeConversationCount: activeConversationId && conversationMessagesCache.has(activeConversationId) ? 1 : 0,
      pendingConversationCount,
      retainedApproxBytes,
      maxConversationEntries,
      maxApproxBytes,
      inactiveTtlMs,
      evictedConversationCount,
      generationClearCount,
      oldestInactiveAgeMs,
      overBudget: isOverBudget(),
      disposed,
    };
  }

  return {
    bindAgentConversation,
    getAgentConversation,
    setConversationMessages,
    getConversationMessages,
    appendConversationMessage,
    appendUserMessage,
    appendAssistantDelta,
    finalizeAssistantMessage,
    setActiveConversation,
    clearGeneration,
    dispose,
    getRuntimeSnapshot,
  };
}

function estimateConversationBytes(items) {
  let total = CONVERSATION_ENTRY_OVERHEAD_BYTES;
  for (const item of Array.isArray(items) ? items : []) {
    total += MESSAGE_OVERHEAD_BYTES;
    total += estimateStringBytes(item?.id);
    total += estimateStringBytes(item?.role);
    total += estimateStringBytes(item?.content);
    total += estimateStringBytes(item?.displayTimeText);
    total += estimateStringBytes(item?.agentId);
  }
  return total;
}

function estimateStringBytes(value) {
  return typeof value === "string" ? value.length * 2 : 0;
}

function normalizeNonNegativeInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
