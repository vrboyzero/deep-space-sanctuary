export function createSetupGuidanceFeature({
  openGuidance,
  delayMs = 500,
} = {}) {
  let timer = null;
  let generation = 0;
  let disposed = false;

  function clear() {
    generation += 1;
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (disposed) return;
    clear();
    const scheduledGeneration = generation;
    timer = setTimeout(() => {
      timer = null;
      if (disposed || scheduledGeneration !== generation) return;
      openGuidance?.();
    }, delayMs);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clear();
  }

  function getRuntimeSnapshot() {
    return {
      activeTimerCount: timer === null ? 0 : 1,
      generation,
      disposed,
    };
  }

  return {
    clear,
    dispose,
    getRuntimeSnapshot,
    schedule,
  };
}
