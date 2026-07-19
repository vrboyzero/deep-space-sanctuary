export function createMemoryViewerDreamRuntimeLifecycle() {
  const pendingRequests = new Set();
  const generations = { commons: 0, status: 0 };
  let disposed = false;

  async function run(kind, operation) {
    if (disposed || typeof operation !== "function") return undefined;
    const requestGeneration = ++generations[kind];
    const token = { kind };
    const isCurrent = () => !disposed && generations[kind] === requestGeneration;
    pendingRequests.add(token);
    try {
      return await operation({ isCurrent });
    } catch (error) {
      if (!isCurrent()) return undefined;
      throw error;
    } finally {
      // dispose 只隔离迟到提交，pending 保留到真实请求完成，便于诊断物理结算。
      pendingRequests.delete(token);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generations.commons += 1;
    generations.status += 1;
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      dreamRuntimeCommonsGeneration: generations.commons,
      dreamRuntimeStatusGeneration: generations.status,
      pendingDreamRuntimeRequestCount: pendingRequests.size,
      pendingDreamRuntimeCommonsRequestCount: [...pendingRequests].filter((token) => token.kind === "commons").length,
      pendingDreamRuntimeStatusRequestCount: [...pendingRequests].filter((token) => token.kind === "status").length,
    };
  }

  return { dispose, getRuntimeSnapshot, run };
}
