export function createMemoryViewerDreamHistoryLifecycle() {
  const pendingRequests = new Set();
  let generation = 0;
  let disposed = false;

  async function run(kind, operation) {
    if (disposed || typeof operation !== "function") return undefined;
    const requestGeneration = generation;
    const token = { kind };
    pendingRequests.add(token);
    try {
      return await operation();
    } catch (error) {
      if (disposed || requestGeneration !== generation) return undefined;
      throw error;
    } finally {
      pendingRequests.delete(token);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      dreamHistoryGeneration: generation,
      pendingDreamHistoryRequestCount: pendingRequests.size,
      pendingDreamHistoryListRequestCount: [...pendingRequests].filter((token) => token.kind === "list").length,
      pendingDreamHistoryDetailRequestCount: [...pendingRequests].filter((token) => token.kind === "detail").length,
    };
  }

  return { dispose, getRuntimeSnapshot, run };
}
