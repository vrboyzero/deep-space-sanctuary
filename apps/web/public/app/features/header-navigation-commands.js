export const HEADER_NAVIGATION_COMMANDS = Object.freeze({
  LOAD_GOALS: "header.navigation.load-goals",
  LOAD_BRIDGE: "header.navigation.load-bridge",
  FOCUS_CHAT: "header.navigation.focus-chat",
});

const SUPPORTED_COMMANDS = new Set(Object.values(HEADER_NAVIGATION_COMMANDS));

function staleResult() {
  return {
    handled: false,
    stale: true,
    value: undefined,
  };
}

export function createLegacyHeaderNavigationCommandAdapter({
  loadGoals,
  loadBridgeSessions,
  focusPrompt,
} = {}) {
  return Object.freeze({
    dispatch(command) {
      switch (command) {
        case HEADER_NAVIGATION_COMMANDS.LOAD_GOALS:
          return loadGoals?.(false);
        case HEADER_NAVIGATION_COMMANDS.LOAD_BRIDGE:
          return loadBridgeSessions?.(false);
        case HEADER_NAVIGATION_COMMANDS.FOCUS_CHAT:
          return focusPrompt?.();
        default:
          return undefined;
      }
    },
  });
}

export function createHeaderNavigationCommandOwner() {
  const handlers = new Map();
  let pendingCommandCount = 0;
  let disposed = false;

  function register(command, handler) {
    if (disposed || !SUPPORTED_COMMANDS.has(command) || typeof handler !== "function") return null;
    const entry = { handler };
    handlers.set(command, entry);
    return () => {
      if (handlers.get(command) !== entry) return false;
      handlers.delete(command);
      return true;
    };
  }

  async function dispatch(command, payload) {
    if (disposed) return staleResult();
    const entry = handlers.get(command);
    if (!entry) {
      return {
        handled: false,
        stale: false,
        value: undefined,
      };
    }

    pendingCommandCount += 1;
    try {
      const value = await entry.handler(payload);
      if (disposed || handlers.get(command) !== entry) return staleResult();
      return {
        handled: true,
        stale: false,
        value,
      };
    } catch (error) {
      // 被替换 owner 的迟到错误不再污染当前 consumer；active 错误保持原契约。
      if (disposed || handlers.get(command) !== entry) return staleResult();
      throw error;
    } finally {
      pendingCommandCount = Math.max(0, pendingCommandCount - 1);
    }
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    handlers.clear();
    return true;
  }

  function getRuntimeSnapshot() {
    return {
      registeredHeaderNavigationCommandCount: handlers.size,
      pendingHeaderNavigationCommandCount: pendingCommandCount,
      headerNavigationCommandDisposed: disposed,
    };
  }

  return Object.freeze({
    register,
    dispatch,
    dispose,
    getRuntimeSnapshot,
  });
}
