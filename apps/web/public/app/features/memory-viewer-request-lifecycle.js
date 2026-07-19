export function createMemoryViewerRequestLifecycle({
  invalidateRequestContext,
} = {}) {
  const pendingLoadRequests = new Set();
  let generation = 0;
  let disposed = false;

  function isActive(expectedGeneration = generation) {
    return !disposed && expectedGeneration === generation;
  }

  async function run(operation) {
    if (disposed || typeof operation !== "function") return undefined;
    const operationGeneration = generation;
    const requestToken = Symbol("memory-viewer-load");
    pendingLoadRequests.add(requestToken);
    try {
      return await operation({
        generation: operationGeneration,
        isCurrent: () => isActive(operationGeneration),
      });
    } catch (error) {
      if (!isActive(operationGeneration)) return undefined;
      throw error;
    } finally {
      pendingLoadRequests.delete(requestToken);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    invalidateRequestContext?.();
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      generation,
      pendingLoadRequestCount: pendingLoadRequests.size,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    isActive,
    run,
  };
}
