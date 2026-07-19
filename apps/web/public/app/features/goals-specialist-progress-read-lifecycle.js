export function createGoalsSpecialistProgressReadLifecycle() {
  const pendingReads = new Set();
  let generation = 0;
  let disposed = false;

  async function run(operation) {
    if (disposed || typeof operation !== "function") return undefined;
    const readGeneration = ++generation;
    const token = Symbol("goal-progress-read");
    const isCurrent = () => !disposed && generation === readGeneration;
    pendingReads.add(token);
    try {
      return await operation({ isCurrent });
    } catch (error) {
      if (!isCurrent()) return undefined;
      throw error;
    } finally {
      // generation 只阻止迟到提交，pending 必须保留到真实文件读取结算。
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
      goalProgressReadGeneration: generation,
      pendingGoalProgressReadCount: pendingReads.size,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    run,
  };
}
