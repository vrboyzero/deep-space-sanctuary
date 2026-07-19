export function createGoalsSpecialistTrackingReadLifecycle() {
  const pendingReads = new Set();
  let generation = 0;
  let disposed = false;

  async function run(operation) {
    if (disposed || typeof operation !== "function") return undefined;
    const readGeneration = ++generation;
    const token = Symbol("goal-tracking-read");
    const isCurrent = () => !disposed && generation === readGeneration;
    pendingReads.add(token);
    try {
      return await operation({ isCurrent });
    } catch (error) {
      if (!isCurrent()) return undefined;
      throw error;
    } finally {
      // pending 覆盖 source reads、capability cache 与 tracking runtime index 的整条物理读取链。
      pendingReads.delete(token);
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
      goalTrackingReadGeneration: generation,
      pendingGoalTrackingReadCount: pendingReads.size,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    run,
  };
}
