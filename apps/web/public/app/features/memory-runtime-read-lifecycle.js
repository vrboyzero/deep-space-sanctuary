export function createMemoryRuntimeReadLifecycle() {
  const pendingReads = new Set();
  const generations = { candidate: 0, memory: 0, task: 0 };
  let disposed = false;

  async function run(kind, operation) {
    if (disposed || typeof operation !== "function") return undefined;
    const readGeneration = ++generations[kind];
    const token = { kind };
    const isCurrent = () => !disposed && generations[kind] === readGeneration;
    pendingReads.add(token);
    try {
      return await operation({ isCurrent });
    } catch (error) {
      if (!isCurrent()) return undefined;
      throw error;
    } finally {
      // generation 只隔离提交，pending 直到真实 read Promise 结算后才释放。
      pendingReads.delete(token);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generations.candidate += 1;
    generations.memory += 1;
    generations.task += 1;
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      memoryRuntimeCandidateReadGeneration: generations.candidate,
      memoryRuntimeMemoryReadGeneration: generations.memory,
      memoryRuntimeTaskReadGeneration: generations.task,
      pendingMemoryRuntimeReadCount: pendingReads.size,
      pendingMemoryRuntimeCandidateReadCount: [...pendingReads].filter((token) => token.kind === "candidate").length,
      pendingMemoryRuntimeMemoryReadCount: [...pendingReads].filter((token) => token.kind === "memory").length,
      pendingMemoryRuntimeTaskReadCount: [...pendingReads].filter((token) => token.kind === "task").length,
    };
  }

  return { dispose, getRuntimeSnapshot, run };
}
