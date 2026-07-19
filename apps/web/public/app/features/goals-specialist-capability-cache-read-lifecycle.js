export function createGoalsSpecialistCapabilityCacheReadLifecycle() {
  const currentByGoalId = new Map();
  const pendingReads = new Set();
  let disposed = false;

  function run({
    goalId,
    forceReload = false,
    pendingState = {},
    read,
    commit,
  } = {}) {
    if (disposed || !goalId || typeof read !== "function") return Promise.resolve(undefined);
    if (!forceReload) {
      const current = currentByGoalId.get(goalId);
      if (current) return current.promise;
      if (pendingState?.[goalId]) return Promise.resolve(pendingState[goalId]);
    }

    const entry = {
      goalId,
      pendingState,
      promise: null,
    };
    currentByGoalId.set(goalId, entry);
    pendingReads.add(entry);
    const isCurrent = () => !disposed && currentByGoalId.get(goalId) === entry;

    let operationPromise;
    try {
      operationPromise = Promise.resolve(read());
    } catch (error) {
      operationPromise = Promise.reject(error);
    }
    const promise = operationPromise
      .then((value) => {
        if (!isCurrent()) return undefined;
        if (typeof commit === "function") commit(value);
        return value;
      })
      .catch((error) => {
        if (!isCurrent()) return undefined;
        throw error;
      })
      .finally(() => {
        pendingReads.delete(entry);
        if (currentByGoalId.get(goalId) === entry) currentByGoalId.delete(goalId);
        // forceReload replacement 后，旧 settlement 不得误删新一代公开 pending 信号。
        if (entry.pendingState?.[goalId] === promise) delete entry.pendingState[goalId];
        entry.pendingState = null;
        entry.promise = null;
      });
    entry.promise = promise;
    pendingState[goalId] = promise;
    return promise;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    currentByGoalId.clear();
  }

  function getRuntimeSnapshot() {
    return {
      activeGoalCapabilityCacheGenerationCount: currentByGoalId.size,
      disposed,
      pendingGoalCapabilityCacheReadCount: pendingReads.size,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    isDisposed: () => disposed,
    run,
  };
}
