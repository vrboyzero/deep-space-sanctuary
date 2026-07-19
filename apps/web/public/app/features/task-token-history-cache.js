const DEFAULT_MAX_CONVERSATION_ENTRIES = 64;
const DEFAULT_MAX_APPROX_BYTES = 256 * 1024;
const DEFAULT_MAX_RECORDS_PER_CONVERSATION = 1;
const CONVERSATION_ENTRY_OVERHEAD_BYTES = 64;

export function createTaskTokenHistoryCache(options = {}) {
  const recordsByConversation = new Map();
  const retentionByConversation = new Map();
  const maxConversationEntries = normalizeNonNegativeInteger(
    options.maxConversationEntries,
    DEFAULT_MAX_CONVERSATION_ENTRIES,
  );
  const maxApproxBytes = normalizeNonNegativeInteger(
    options.maxApproxBytes,
    DEFAULT_MAX_APPROX_BYTES,
  );
  const maxRecordsPerConversation = normalizeNonNegativeInteger(
    options.maxRecordsPerConversation,
    DEFAULT_MAX_RECORDS_PER_CONVERSATION,
  );
  const now = typeof options.now === "function" ? options.now : Date.now;
  let activeConversationId = "";
  let retainedApproxBytes = 0;
  let evictedConversationCount = 0;
  let generationClearCount = 0;
  let disposed = false;

  function deleteConversation(conversationId, countEviction = true) {
    const retention = retentionByConversation.get(conversationId);
    if (!retention) return false;
    retainedApproxBytes = Math.max(0, retainedApproxBytes - retention.approxBytes);
    retentionByConversation.delete(conversationId);
    recordsByConversation.delete(conversationId);
    if (countEviction) evictedConversationCount += 1;
    return true;
  }

  function isOverBudget() {
    return recordsByConversation.size > maxConversationEntries
      || retainedApproxBytes > maxApproxBytes;
  }

  function prune() {
    while (isOverBudget()) {
      const candidate = [...retentionByConversation.entries()]
        .filter(([conversationId]) => conversationId !== activeConversationId)
        .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0];
      if (!candidate) return;
      deleteConversation(candidate[0]);
    }
  }

  function write(conversationId, records) {
    if (disposed || !conversationId) return;
    const normalized = Array.isArray(records)
      ? records.slice(0, maxRecordsPerConversation).map((record) => ({ ...record }))
      : [];
    if (normalized.length === 0) {
      deleteConversation(conversationId, false);
      return;
    }

    const previous = retentionByConversation.get(conversationId);
    if (previous) {
      retainedApproxBytes = Math.max(0, retainedApproxBytes - previous.approxBytes);
    }
    const approxBytes = estimateRecordsBytes(normalized);
    recordsByConversation.set(conversationId, normalized);
    retentionByConversation.set(conversationId, {
      approxBytes,
      lastAccessedAt: now(),
    });
    retainedApproxBytes += approxBytes;
    prune();
  }

  function set(conversationId, records) {
    write(conversationId, records);
  }

  function prepend(conversationId, record) {
    if (disposed || !conversationId || !record || typeof record !== "object") return;
    const current = recordsByConversation.get(conversationId) ?? [];
    write(conversationId, [{ ...record }, ...current]);
  }

  function get(conversationId) {
    if (disposed) return [];
    const records = recordsByConversation.get(conversationId);
    const retention = retentionByConversation.get(conversationId);
    if (retention) retention.lastAccessedAt = now();
    return Array.isArray(records) ? records.map((record) => ({ ...record })) : [];
  }

  function setActiveConversation(conversationId) {
    if (disposed) return;
    activeConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    const retention = retentionByConversation.get(activeConversationId);
    if (retention) retention.lastAccessedAt = now();
    prune();
  }

  function clearGeneration() {
    if (disposed) return;
    recordsByConversation.clear();
    retentionByConversation.clear();
    activeConversationId = "";
    retainedApproxBytes = 0;
    generationClearCount += 1;
  }

  function dispose() {
    if (disposed) return;
    recordsByConversation.clear();
    retentionByConversation.clear();
    activeConversationId = "";
    retainedApproxBytes = 0;
    disposed = true;
  }

  function getRuntimeSnapshot() {
    const currentTime = now();
    let retainedRecordCount = 0;
    let oldestInactiveAgeMs = 0;
    for (const [conversationId, records] of recordsByConversation) {
      retainedRecordCount += records.length;
      if (conversationId !== activeConversationId) {
        const retention = retentionByConversation.get(conversationId);
        oldestInactiveAgeMs = Math.max(
          oldestInactiveAgeMs,
          Math.max(0, currentTime - (retention?.lastAccessedAt ?? currentTime)),
        );
      }
    }
    return {
      retainedConversationCount: recordsByConversation.size,
      retainedRecordCount,
      activeConversationCount: activeConversationId && recordsByConversation.has(activeConversationId) ? 1 : 0,
      retainedApproxBytes,
      maxConversationEntries,
      maxApproxBytes,
      maxRecordsPerConversation,
      evictedConversationCount,
      generationClearCount,
      oldestInactiveAgeMs,
      overBudget: isOverBudget(),
      disposed,
    };
  }

  return {
    set,
    prepend,
    get,
    setActiveConversation,
    clearGeneration,
    dispose,
    getRuntimeSnapshot,
  };
}

function estimateRecordsBytes(records) {
  let total = CONVERSATION_ENTRY_OVERHEAD_BYTES;
  for (const record of records) {
    try {
      total += JSON.stringify(record).length * 2;
    } catch {
      total += CONVERSATION_ENTRY_OVERHEAD_BYTES;
    }
  }
  return total;
}

function normalizeNonNegativeInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
