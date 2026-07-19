export function createMemoryViewerIngressLifecycle() {
  let disposed = false;

  function guard(command, fallbackValue) {
    return (...args) => (disposed ? fallbackValue : command(...args));
  }

  function guardAsync(command, fallbackValue = null) {
    return async (...args) => (disposed ? fallbackValue : command(...args));
  }

  function dispose() {
    disposed = true;
  }

  function getRuntimeSnapshot() {
    return { memoryViewerIngressDisposed: disposed };
  }

  return { dispose, getRuntimeSnapshot, guard, guardAsync };
}
