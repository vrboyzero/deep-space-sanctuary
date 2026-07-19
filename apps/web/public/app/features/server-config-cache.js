const DEFAULT_TTL_MS = 2_000;

export function createServerConfigCache(options = {}) {
  const ttlMs = normalizeNonNegativeInteger(options.ttlMs, DEFAULT_TTL_MS);
  const now = typeof options.now === "function" ? options.now : Date.now;
  let cachedValue = null;
  let cachedAt = 0;
  let hasCachedValue = false;
  let activePromise = null;
  let generation = 0;
  let requestRevision = 0;
  let cacheHitCount = 0;
  let singleflightHitCount = 0;
  let loadStartCount = 0;
  let staleResultCount = 0;
  let generationClearCount = 0;
  let disposed = false;

  function clearCachedValue() {
    cachedValue = null;
    cachedAt = 0;
    hasCachedValue = false;
  }

  function isCurrent(loadGeneration, loadRevision) {
    return !disposed
      && loadGeneration === generation
      && loadRevision === requestRevision;
  }

  async function load(loader, loadOptions = {}) {
    if (disposed || typeof loader !== "function") return null;
    const force = loadOptions.force === true;
    const currentTime = now();
    if (!force && hasCachedValue && currentTime - cachedAt < ttlMs) {
      cacheHitCount += 1;
      return cachedValue;
    }
    if (!force && activePromise) {
      singleflightHitCount += 1;
      return activePromise;
    }

    const loadGeneration = generation;
    const loadRevision = ++requestRevision;
    const transform = typeof loadOptions.transform === "function"
      ? loadOptions.transform
      : (value) => value;
    const shouldCache = typeof loadOptions.shouldCache === "function"
      ? loadOptions.shouldCache
      : (value) => value !== null && value !== undefined;
    loadStartCount += 1;

    const promise = (async () => {
      let value;
      try {
        value = await loader();
      } catch (error) {
        if (!isCurrent(loadGeneration, loadRevision)) {
          staleResultCount += 1;
          return null;
        }
        throw error;
      }
      // 断线、认证切换或 force supersede 后，旧请求只能结算自身 caller，不能提交 cache。
      if (!isCurrent(loadGeneration, loadRevision)) {
        staleResultCount += 1;
        return null;
      }
      let transformedValue;
      try {
        transformedValue = await transform(value);
      } catch (error) {
        if (!isCurrent(loadGeneration, loadRevision)) {
          staleResultCount += 1;
          return null;
        }
        throw error;
      }
      if (!isCurrent(loadGeneration, loadRevision)) {
        staleResultCount += 1;
        return null;
      }
      if (shouldCache(transformedValue)) {
        cachedValue = transformedValue;
        cachedAt = now();
        hasCachedValue = true;
      } else {
        clearCachedValue();
      }
      return transformedValue;
    })();

    activePromise = promise;
    try {
      return await promise;
    } finally {
      if (activePromise === promise) activePromise = null;
    }
  }

  function clearGeneration() {
    if (disposed) return;
    clearCachedValue();
    activePromise = null;
    generation += 1;
    requestRevision += 1;
    generationClearCount += 1;
  }

  function dispose() {
    if (disposed) return;
    clearCachedValue();
    activePromise = null;
    generation += 1;
    requestRevision += 1;
    disposed = true;
  }

  function getRuntimeSnapshot() {
    return {
      cachedEntryCount: hasCachedValue ? 1 : 0,
      pendingRequestCount: activePromise ? 1 : 0,
      ttlMs,
      cacheAgeMs: hasCachedValue ? Math.max(0, now() - cachedAt) : 0,
      cacheHitCount,
      singleflightHitCount,
      loadStartCount,
      staleResultCount,
      generationClearCount,
      disposed,
    };
  }

  return {
    load,
    clearGeneration,
    dispose,
    getRuntimeSnapshot,
  };
}

function normalizeNonNegativeInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
