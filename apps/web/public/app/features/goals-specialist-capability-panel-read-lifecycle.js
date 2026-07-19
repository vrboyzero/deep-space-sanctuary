export function createGoalsSpecialistCapabilityPanelReadLifecycle() {
  const pendingReads = new Set();
  let generation = 0;
  let disposed = false;

  async function run(operation) {
    if (disposed || typeof operation !== "function") return undefined;
    const readGeneration = ++generation;
    const token = Symbol("goal-capability-panel-read");
    const isCurrent = () => !disposed && generation === readGeneration;
    pendingReads.add(token);
    try {
      return await operation({ isCurrent });
    } catch (error) {
      if (!isCurrent()) return undefined;
      throw error;
    } finally {
      // pending 覆盖 capability cache 与 governance summary 的外层 render chain。
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
      goalCapabilityPanelReadGeneration: generation,
      pendingGoalCapabilityPanelReadCount: pendingReads.size,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    run,
  };
}
