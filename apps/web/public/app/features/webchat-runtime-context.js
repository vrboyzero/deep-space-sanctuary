const DEFAULT_AGENT_ID = "default";

function fallbackTranslate(key, _params, fallback) {
  if (typeof fallback === "string") return fallback;
  return typeof key === "string" ? key : "";
}

export function createDefaultWebChatRuntimeAdapter({
  sendReq,
  isConnected,
  switchMode,
  t,
  showNotice,
  getCurrentAgentSelection,
} = {}) {
  return Object.freeze({
    gateway: Object.freeze({
      request: typeof sendReq === "function"
        ? (...args) => sendReq(...args)
        : () => Promise.resolve(null),
      isConnected: typeof isConnected === "function"
        ? () => Boolean(isConnected())
        : () => false,
    }),
    navigation: Object.freeze({
      switchMode: typeof switchMode === "function"
        ? (...args) => switchMode(...args)
        : () => false,
    }),
    locale: Object.freeze({
      t: typeof t === "function"
        ? (...args) => t(...args)
        : fallbackTranslate,
    }),
    notice: Object.freeze({
      show: typeof showNotice === "function"
        ? (...args) => showNotice(...args)
        : () => false,
    }),
    identity: Object.freeze({
      getActiveAgentId: typeof getCurrentAgentSelection === "function"
        ? () => getCurrentAgentSelection() || DEFAULT_AGENT_ID
        : () => DEFAULT_AGENT_ID,
    }),
  });
}

function bindAdapterMethod(capability, methodName, fallback) {
  const method = capability?.[methodName];
  if (typeof method !== "function") return fallback;
  return (...args) => method.apply(capability, args);
}

function normalizeRuntimeAdapter(adapter) {
  const defaults = createDefaultWebChatRuntimeAdapter();
  return {
    gateway: {
      request: bindAdapterMethod(adapter?.gateway, "request", defaults.gateway.request),
      isConnected: bindAdapterMethod(adapter?.gateway, "isConnected", defaults.gateway.isConnected),
    },
    navigation: {
      switchMode: bindAdapterMethod(adapter?.navigation, "switchMode", defaults.navigation.switchMode),
    },
    locale: {
      t: bindAdapterMethod(adapter?.locale, "t", defaults.locale.t),
    },
    notice: {
      show: bindAdapterMethod(adapter?.notice, "show", defaults.notice.show),
    },
    identity: {
      getActiveAgentId: bindAdapterMethod(
        adapter?.identity,
        "getActiveAgentId",
        defaults.identity.getActiveAgentId,
      ),
    },
    dispose: typeof adapter?.dispose === "function"
      ? () => adapter.dispose()
      : () => {},
  };
}

export function createWebChatRuntimeContext({ adapter } = {}) {
  let currentAdapter = normalizeRuntimeAdapter(adapter);
  let generation = 1;
  let disposed = false;

  // Capability 对象保持稳定，consumer 不会继续持有已替换的 Adapter owner。
  const gateway = Object.freeze({
    request: (...args) => disposed
      ? Promise.resolve(null)
      : currentAdapter.gateway.request(...args),
    isConnected: () => !disposed && Boolean(currentAdapter.gateway.isConnected()),
  });
  const navigation = Object.freeze({
    switchMode: (...args) => disposed
      ? false
      : currentAdapter.navigation.switchMode(...args),
  });
  const locale = Object.freeze({
    t: (...args) => disposed
      ? fallbackTranslate(...args)
      : currentAdapter.locale.t(...args),
  });
  const notice = Object.freeze({
    show: (...args) => disposed
      ? false
      : currentAdapter.notice.show(...args),
  });
  const identity = Object.freeze({
    getActiveAgentId: () => disposed
      ? DEFAULT_AGENT_ID
      : currentAdapter.identity.getActiveAgentId() || DEFAULT_AGENT_ID,
  });

  function replaceAdapter(nextAdapter) {
    if (disposed) return false;
    const previousAdapter = currentAdapter;
    currentAdapter = normalizeRuntimeAdapter(nextAdapter);
    generation += 1;
    previousAdapter.dispose();
    return true;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    generation += 1;
    const previousAdapter = currentAdapter;
    currentAdapter = normalizeRuntimeAdapter();
    previousAdapter.dispose();
    return true;
  }

  function getRuntimeSnapshot() {
    return {
      runtimeContextGeneration: generation,
      runtimeContextDisposed: disposed,
    };
  }

  return Object.freeze({
    gateway,
    navigation,
    locale,
    notice,
    identity,
    replaceAdapter,
    dispose,
    getRuntimeSnapshot,
  });
}
