const DEFAULT_MAX_ENTRIES = 128;

export function createEmailThreadAdviceRetention(options = {}) {
  const entries = new Map();
  const maxEntries = normalizeNonNegativeInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const now = typeof options.now === "function" ? options.now : Date.now;
  let nextToken = 0;
  let generation = 0;
  let evictedEntryCount = 0;
  let generationClearCount = 0;
  let disposed = false;

  function countSettledEntries() {
    let count = 0;
    for (const entry of entries.values()) {
      if (entry.state === "settled") count += 1;
    }
    return count;
  }

  function prune() {
    let settledEntryCount = countSettledEntries();
    while (settledEntryCount > maxEntries) {
      let candidateKey = "";
      let candidateAccessedAt = Number.POSITIVE_INFINITY;
      for (const [key, entry] of entries) {
        // Pending 请求必须保留到 settlement，容量压力只回收已成功的 terminal key。
        if (entry.state !== "settled" || entry.lastAccessedAt >= candidateAccessedAt) continue;
        candidateKey = key;
        candidateAccessedAt = entry.lastAccessedAt;
      }
      if (!candidateKey) return;
      entries.delete(candidateKey);
      settledEntryCount -= 1;
      evictedEntryCount += 1;
    }
  }

  function begin(conversationId) {
    if (disposed) return null;
    const key = normalizeConversationId(conversationId);
    if (!key) return null;
    const existing = entries.get(key);
    if (existing) {
      existing.lastAccessedAt = now();
      return null;
    }
    const lease = {
      conversationId: key,
      generation,
      token: ++nextToken,
    };
    entries.set(key, {
      generation,
      token: lease.token,
      state: "pending",
      lastAccessedAt: now(),
    });
    prune();
    return lease;
  }

  function findCurrentEntry(lease) {
    if (disposed || !lease || lease.generation !== generation) return null;
    const key = normalizeConversationId(lease.conversationId);
    const entry = entries.get(key);
    if (!entry || entry.generation !== lease.generation || entry.token !== lease.token) return null;
    return { key, entry };
  }

  function succeed(lease) {
    const current = findCurrentEntry(lease);
    if (!current) return false;
    current.entry.state = "settled";
    current.entry.lastAccessedAt = now();
    prune();
    return true;
  }

  function fail(lease) {
    const current = findCurrentEntry(lease);
    if (!current) return false;
    entries.delete(current.key);
    return true;
  }

  function has(conversationId) {
    if (disposed) return false;
    const entry = entries.get(normalizeConversationId(conversationId));
    if (!entry) return false;
    entry.lastAccessedAt = now();
    return true;
  }

  function clearGeneration() {
    if (disposed) return;
    entries.clear();
    generation += 1;
    generationClearCount += 1;
  }

  function dispose() {
    if (disposed) return;
    entries.clear();
    generation += 1;
    disposed = true;
  }

  function getRuntimeSnapshot() {
    let pendingEntryCount = 0;
    for (const entry of entries.values()) {
      if (entry.state === "pending") pendingEntryCount += 1;
    }
    return {
      retainedEntryCount: entries.size,
      pendingEntryCount,
      settledEntryCount: entries.size - pendingEntryCount,
      maxEntries,
      evictedEntryCount,
      generationClearCount,
      overBudget: entries.size > maxEntries,
      disposed,
    };
  }

  return {
    begin,
    succeed,
    fail,
    has,
    clearGeneration,
    dispose,
    getRuntimeSnapshot,
  };
}

function normalizeConversationId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNonNegativeInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
