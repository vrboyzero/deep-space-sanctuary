import { describe, expect, it, vi } from "vitest";

import {
  buildManualModelValue,
  buildModelCatalogGroups,
  formatModelOptionLabel,
  formatModelProviderGroupLabel,
  createChatNetworkFeature,
  MANUAL_MODEL_SENTINEL,
  PENDING_AGENT_SELECTION_KEY,
  modelMatchesCatalogFilter,
  normalizeRequestFrame,
  parseManualModelValue,
  resolvePreferredAgentSelection,
  resolvePreferredModelSelection,
  shouldClearTransientSetupTokenOnClose,
  syncAgentSelectOptions,
} from "./chat-network.js";
import { createAgentSessionCacheFeature } from "./agent-session-cache.js";

describe("chat network agent selection", () => {
  const agents = [
    { id: "coder", displayName: "代码专家" },
    { id: "default", displayName: "Belldandy" },
    { id: "researcher", displayName: "调研助手" },
  ];

  it("keeps the current selection when the roster order changes", () => {
    expect(resolvePreferredAgentSelection(agents, "default", "")).toBe("default");
  });

  it("prefers the pending created agent after restart when it appears in the roster", () => {
    expect(resolvePreferredAgentSelection(agents, "default", "researcher", "coder")).toBe("coder");
  });

  it("falls back to the saved selection when current selection is unavailable", () => {
    expect(resolvePreferredAgentSelection(agents, "missing", "researcher")).toBe("researcher");
  });

  it("falls back to the first roster entry when no selection can be restored", () => {
    expect(resolvePreferredAgentSelection(agents, "missing", "also-missing")).toBe("coder");
  });

  it("keeps a single-agent roster selectable even when the native select stays hidden", () => {
    const createdOptions = [];
    const selectEl = {
      innerHTML: "existing",
      options: createdOptions,
      value: "",
      appendChild(option) {
        this.options.push(option);
      },
    };
    const singleAgentRoster = [{ id: "coder", displayName: "代码专家" }];
    const previousDocument = globalThis.document;

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement(tag) {
          expect(tag).toBe("option");
          return {
            value: "",
            textContent: "",
          };
        },
      },
    });

    try {
      syncAgentSelectOptions(selectEl, singleAgentRoster);
      selectEl.value = resolvePreferredAgentSelection(singleAgentRoster, "", "");
    } finally {
      if (previousDocument === undefined) {
        delete globalThis.document;
      } else {
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: previousDocument,
        });
      }
    }

    expect(selectEl.options).toHaveLength(1);
    expect(selectEl.options[0].value).toBe("coder");
    expect(selectEl.value).toBe("coder");
  });
});

describe("chat network pending agent selection key", () => {
  it("uses a stable sessionStorage key for post-restart roster recovery", () => {
    expect(PENDING_AGENT_SELECTION_KEY).toBe("pending-agent-selection-id");
  });
});

describe("chat network model selection", () => {
  const models = [
    {
      id: "primary",
      displayName: "gpt-5（默认）",
      model: "gpt-5",
      providerLabel: "OpenAI",
      providerId: "openai",
      source: "primary",
      authStatus: "ready",
      isDefault: true,
    },
    {
      id: "claude-opus",
      displayName: "Claude Opus 4.5",
      model: "claude-opus-4-5",
      providerLabel: "Anthropic",
      providerId: "anthropic",
      source: "named",
      authStatus: "missing",
      isDefault: false,
    },
    {
      id: "moonshot-kimi",
      displayName: "Kimi K2.5",
      model: "kimi-k2.5",
      providerLabel: "Moonshot",
      providerId: "moonshot",
      source: "named",
      authStatus: "ready",
      isDefault: false,
    },
  ];

  it("formats provider and auth state into option labels", () => {
    expect(formatModelOptionLabel(models[0])).toBe("gpt-5（默认）");
    expect(formatModelOptionLabel(models[1])).toBe("Claude Opus 4.5 · auth missing");
  });

  it("preserves valid manual model selections when manual entry is supported", () => {
    const manualValue = buildManualModelValue("gpt-5.1-mini");
    expect(parseManualModelValue(manualValue)).toBe("gpt-5.1-mini");
    expect(resolvePreferredModelSelection(models, "", manualValue, true)).toBe(manualValue);
  });

  it("falls back to listed models when manual entry is unavailable", () => {
    expect(resolvePreferredModelSelection(models, "missing", "claude-opus", false)).toBe("claude-opus");
    expect(resolvePreferredModelSelection(models, "", buildManualModelValue("gpt-5.1-mini"), false)).toBe("");
  });

  it("groups providers with preferred ready providers first", () => {
    const groups = buildModelCatalogGroups(models, "primary");
    expect(groups.map((group) => group.providerId)).toEqual(["openai", "moonshot", "anthropic"]);
    expect(formatModelProviderGroupLabel(groups[0])).toBe("OpenAI · preferred");
    expect(formatModelProviderGroupLabel(groups[2])).toBe("Anthropic · auth missing");
  });

  it("uses explicit preferred provider order before inferred default-provider order", () => {
    const groups = buildModelCatalogGroups(models, "primary", ["moonshot", "anthropic"]);
    expect(groups.map((group) => group.providerId)).toEqual(["moonshot", "anthropic", "openai"]);
    expect(formatModelProviderGroupLabel(groups[0])).toBe("Moonshot · preferred");
    expect(formatModelProviderGroupLabel(groups[1])).toBe("Anthropic · preferred · auth missing");
  });

  it("filters catalog by model or provider keyword", () => {
    expect(modelMatchesCatalogFilter(models[1], "anth")).toBe(true);
    expect(modelMatchesCatalogFilter(models[2], "kimi")).toBe(true);
    expect(modelMatchesCatalogFilter(models[0], "moonshot")).toBe(false);
  });
});

describe("chat network request frame normalization", () => {
  it("defaults websocket requests to req frames", () => {
    expect(normalizeRequestFrame({ id: "req-1", method: "email_inbound.audit.list" })).toEqual({
      type: "req",
      id: "req-1",
      method: "email_inbound.audit.list",
    });
  });

  it("fills a missing request id when makeId is available", () => {
    expect(normalizeRequestFrame(
      { method: "conversation.meta", params: { conversationId: "channel=email:123" } },
      () => "generated-id",
    )).toEqual({
      type: "req",
      id: "generated-id",
      method: "conversation.meta",
      params: { conversationId: "channel=email:123" },
    });
  });

  it("drops malformed request frames before they reach the websocket", () => {
    expect(normalizeRequestFrame({ id: "req-2" })).toBeNull();
    expect(normalizeRequestFrame(null)).toBeNull();
    expect(normalizeRequestFrame("bad-frame")).toBeNull();
  });
});

describe("chat network transient setup token recovery", () => {
  it("clears only setup tokens rejected as invalid", () => {
    expect(shouldClearTransientSetupTokenOnClose({
      event: { code: 4403, reason: "invalid token" },
      authMode: "token",
      authValue: "setup-123456",
    })).toBe(true);
  });

  it("keeps non-setup tokens and other close reasons intact", () => {
    expect(shouldClearTransientSetupTokenOnClose({
      event: { code: 4403, reason: "invalid token" },
      authMode: "token",
      authValue: "permanent-token",
    })).toBe(false);
    expect(shouldClearTransientSetupTokenOnClose({
      event: { code: 4403, reason: "token required" },
      authMode: "token",
      authValue: "setup-123456",
    })).toBe(false);
    expect(shouldClearTransientSetupTokenOnClose({
      event: { code: 1006, reason: "invalid token" },
      authMode: "token",
      authValue: "setup-123456",
    })).toBe(false);
  });
});

function createConnectionHarness(options = {}) {
  const previousLocation = globalThis.location;
  const previousStartup = globalThis.__SS_WEBCHAT_STARTUP__;
  const previousWebSocket = globalThis.WebSocket;
  const sockets = [];
  let currentSocket = null;
  let ready = false;
  let requestId = 0;

  class FakeWebSocket {
    static CLOSED = 3;

    constructor(url) {
      const listeners = new Map();
      const socket = {
        url,
        readyState: 0,
        sent: [],
        closeCalls: 0,
        addEventListener(type, listener) {
          const registered = listeners.get(type) ?? [];
          registered.push(listener);
          listeners.set(type, registered);
        },
        removeEventListener(type, listener) {
          const registered = listeners.get(type) ?? [];
          const next = registered.filter((candidate) => candidate !== listener);
          if (next.length > 0) listeners.set(type, next);
          else listeners.delete(type);
        },
        send(data) {
          this.sent.push(data);
        },
        close() {
          this.closeCalls += 1;
        },
        dispatch(type, event = {}) {
          for (const listener of listeners.get(type) ?? []) {
            listener(event);
          }
        },
        getRetainedListener(type) {
          return (listeners.get(type) ?? [])[0];
        },
        getListenerCount() {
          let count = 0;
          for (const registered of listeners.values()) count += registered.length;
          return count;
        },
      };
      sockets.push(socket);
      return socket;
    }
  }

  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      protocol: "http:",
      host: "127.0.0.1:28889",
    },
  });
  Object.defineProperty(globalThis, "__SS_WEBCHAT_STARTUP__", {
    configurable: true,
    value: { mark: () => {} },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeWebSocket,
  });
  vi.useFakeTimers();

  const feature = createChatNetworkFeature({
    refs: {
      statusEl: null,
      sendBtn: null,
      authModeEl: { value: "none" },
      authValueEl: { value: "" },
      workspaceRootsEl: { value: "" },
      userUuidEl: { value: "" },
      agentSelectEl: null,
      modelPickerEl: options.modelPickerEl ?? null,
      modelFilterEl: options.modelFilterEl ?? null,
      modelSelectEl: options.modelSelectEl ?? null,
    },
    keys: {
      storeKey: "store",
      sessionAuthTokenKey: "session-token",
      workspaceRootsKey: "roots",
      uuidKey: "uuid",
      agentIdKey: "agent",
      modelIdKey: "model",
      clientId: "client-1",
    },
    getTransientUrlToken: () => "",
    getSocket: () => currentSocket,
    setSocket: (value) => {
      currentSocket = value;
    },
    getReady: () => ready,
    setReady: (value) => {
      ready = value;
    },
    persistConnectionFields: () => {},
    setStatus: () => {},
    safeJsonParse: JSON.parse,
    makeId: () => `req-${++requestId}`,
    onConnectionStateChanged: options.onConnectionStateChanged,
    onEvent: options.onEvent,
  });

  return {
    feature,
    sockets,
    restore() {
      vi.clearAllTimers();
      vi.useRealTimers();
      if (previousLocation === undefined) {
        delete globalThis.location;
      } else {
        Object.defineProperty(globalThis, "location", {
          configurable: true,
          value: previousLocation,
        });
      }
      if (previousStartup === undefined) {
        delete globalThis.__SS_WEBCHAT_STARTUP__;
      } else {
        Object.defineProperty(globalThis, "__SS_WEBCHAT_STARTUP__", {
          configurable: true,
          value: previousStartup,
        });
      }
      if (previousWebSocket === undefined) {
        delete globalThis.WebSocket;
      } else {
        Object.defineProperty(globalThis, "WebSocket", {
          configurable: true,
          value: previousWebSocket,
        });
      }
    },
  };
}

function createModelControlHarness(value = "") {
  const listeners = new Map();
  const retainedListeners = new Map();
  const classes = new Set();
  return {
    value,
    options: [],
    classList: {
      add(name) {
        classes.add(name);
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
      retainedListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    getRetainedListener(type) {
      return retainedListeners.get(type);
    },
    getListenerCount() {
      return listeners.size;
    },
  };
}

describe("chat network connection close", () => {
  it("clears conversation cache state at connection generation boundaries", () => {
    const sessionCache = createAgentSessionCacheFeature();
    const harness = createConnectionHarness({
      onConnectionStateChanged: ({ ready }) => {
        if (!ready) sessionCache.clearGeneration();
      },
    });

    try {
      sessionCache.bindAgentConversation("agent-stale", "conv-stale", { main: true });
      sessionCache.setConversationMessages("conv-stale", [{ role: "user", content: "stale" }]);

      harness.feature.connect();

      expect(sessionCache.getAgentConversation("agent-stale")).toBe("");
      expect(sessionCache.getConversationMessages("conv-stale")).toEqual([]);

      sessionCache.bindAgentConversation("agent-current", "conv-current", { main: true });
      sessionCache.setConversationMessages("conv-current", [{ role: "user", content: "current" }]);
      harness.sockets[0].dispatch("message", { data: JSON.stringify({ type: "hello-ok" }) });
      expect(sessionCache.getConversationMessages("conv-current")).toHaveLength(1);

      harness.sockets[0].dispatch("close", { code: 4403, reason: "token required" });
      expect(sessionCache.getAgentConversation("agent-current")).toBe("");
      expect(sessionCache.getConversationMessages("conv-current")).toEqual([]);
    } finally {
      harness.restore();
    }
  });

  it("handles a websocket close without raising a page error", () => {
    const harness = createConnectionHarness();

    try {
      harness.feature.connect();

      expect(() => harness.sockets[0].dispatch("close", { code: 1006, reason: "" })).not.toThrow();
    } finally {
      harness.restore();
    }
  });

  it("settles pending requests and clears their deadlines when the socket closes", async () => {
    const harness = createConnectionHarness();

    try {
      harness.feature.connect();
      let result = "unsettled";
      const request = harness.feature.sendReq({
        type: "req",
        id: "pending-1",
        method: "system.doctor",
      });
      void request.then((value) => {
        result = value;
      });
      expect(harness.feature.getRuntimeSnapshot()).toMatchObject({
        pendingChatNetworkGenerationCount: 1,
        pendingChatNetworkRequestCount: 1,
      });

      harness.sockets[0].dispatch("close", { code: 4403, reason: "token required" });
      await Promise.resolve();

      expect(result).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(harness.feature.getRuntimeSnapshot()).toMatchObject({
        pendingChatNetworkGenerationCount: 0,
        pendingChatNetworkRequestCount: 0,
      });
    } finally {
      harness.restore();
    }
  });

  it("settles only the requests owned by the socket generation that closed", async () => {
    const harness = createConnectionHarness();

    try {
      harness.feature.connect();
      const oldSocket = harness.sockets[0];
      let oldResult = "unsettled";
      void harness.feature.sendReq({
        type: "req",
        id: "shared-1",
        method: "system.doctor",
      }).then((value) => {
        oldResult = value;
      });

      harness.feature.connect();
      const currentSocket = harness.sockets[1];
      let currentResult = "unsettled";
      void harness.feature.sendReq({
        type: "req",
        id: "shared-1",
        method: "system.doctor",
      }).then((value) => {
        currentResult = value;
      });

      oldSocket.dispatch("close", { code: 4403, reason: "token required" });
      await Promise.resolve();

      expect(oldResult).toBeNull();
      expect(currentResult).toBe("unsettled");
      expect(vi.getTimerCount()).toBe(1);

      const response = { type: "res", id: "shared-1", ok: true, payload: { status: "ok" } };
      currentSocket.dispatch("message", { data: JSON.stringify(response) });
      await Promise.resolve();

      expect(currentResult).toEqual(response);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      harness.restore();
    }
  });

  it("handles repeated close events for one socket only once", () => {
    const harness = createConnectionHarness();

    try {
      harness.feature.connect();
      const socket = harness.sockets[0];

      socket.dispatch("close", { code: 1006, reason: "" });
      socket.dispatch("close", { code: 1006, reason: "" });

      expect(vi.getTimerCount()).toBe(1);
    } finally {
      harness.restore();
    }
  });

  it("unbinds a replaced socket and ignores its retained late message handler", () => {
    const onEvent = vi.fn();
    const harness = createConnectionHarness({ onEvent });

    try {
      harness.feature.connect();
      const oldSocket = harness.sockets[0];
      const retainedOldMessage = oldSocket.getRetainedListener("message");

      harness.feature.connect();
      const currentSocket = harness.sockets[1];
      retainedOldMessage({
        data: JSON.stringify({ type: "event", event: "chat", payload: { generation: "old" } }),
      });
      currentSocket.dispatch("message", {
        data: JSON.stringify({ type: "event", event: "chat", payload: { generation: "current" } }),
      });

      expect(oldSocket.closeCalls).toBe(1);
      expect(oldSocket.getListenerCount()).toBe(0);
      expect(currentSocket.getListenerCount()).toBe(4);
      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onEvent).toHaveBeenCalledWith("chat", { generation: "current" });
    } finally {
      harness.restore();
    }
  });

  it("disposes socket listeners, pending requests, and reconnect work", async () => {
    const onEvent = vi.fn();
    const harness = createConnectionHarness({ onEvent });

    try {
      harness.feature.connect();
      const socket = harness.sockets[0];
      const retainedMessage = socket.getRetainedListener("message");
      let requestResult = "unsettled";
      void harness.feature.sendReq({
        type: "req",
        id: "pending-dispose",
        method: "system.doctor",
      }).then((value) => {
        requestResult = value;
      });
      socket.dispatch("close", { code: 1006, reason: "" });
      expect(vi.getTimerCount()).toBe(1);

      harness.feature.dispose();
      retainedMessage({
        data: JSON.stringify({ type: "event", event: "chat", payload: { late: true } }),
      });
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(requestResult).toBeNull();
      expect(onEvent).not.toHaveBeenCalled();
      expect(socket.getListenerCount()).toBe(0);
      expect(harness.sockets).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(harness.feature.getRuntimeSnapshot()).toMatchObject({
        disposed: true,
        activeChatNetworkConnectionCount: 0,
        activeChatNetworkSocketListenerCount: 0,
        activeChatNetworkReconnectTimerCount: 0,
        pendingChatNetworkGenerationCount: 0,
        pendingChatNetworkRequestCount: 0,
      });
    } finally {
      harness.restore();
    }
  });

  it("unbinds model controls and blocks a retained prompt handler after dispose", () => {
    const previousPrompt = globalThis.prompt;
    const previousLocalStorage = globalThis.localStorage;
    const prompt = vi.fn(() => "");
    const modelSelectEl = createModelControlHarness(MANUAL_MODEL_SENTINEL);
    const modelFilterEl = createModelControlHarness("");
    const modelPickerEl = createModelControlHarness("");
    Object.defineProperty(globalThis, "prompt", { configurable: true, value: prompt });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => "", setItem: () => {} },
    });
    const harness = createConnectionHarness({ modelSelectEl, modelFilterEl, modelPickerEl });

    try {
      const retainedChange = modelSelectEl.getRetainedListener("change");

      harness.feature.dispose();
      retainedChange({ type: "change" });

      expect(prompt).not.toHaveBeenCalled();
      expect(modelSelectEl.getListenerCount()).toBe(0);
      expect(modelFilterEl.getListenerCount()).toBe(0);
      expect(harness.feature.getRuntimeSnapshot()).toMatchObject({
        disposed: true,
        activeChatNetworkModelControlListenerCount: 0,
      });
    } finally {
      harness.restore();
      if (previousPrompt === undefined) delete globalThis.prompt;
      else Object.defineProperty(globalThis, "prompt", { configurable: true, value: previousPrompt });
      if (previousLocalStorage === undefined) delete globalThis.localStorage;
      else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousLocalStorage });
    }
  });
});

describe("chat network startup observability", () => {
  it("emits startup marks while still creating the websocket connection", () => {
    const previousStartup = globalThis.__SS_WEBCHAT_STARTUP__;
    const previousLocation = globalThis.location;
    const marks = [];
    const previousWebSocket = globalThis.WebSocket;
    const socket = {
      readyState: 0,
      addEventListener: () => {},
      close: () => {},
    };
    class FakeWebSocket {
      constructor(url) {
        this.url = url;
        return socket;
      }
    }

    Object.defineProperty(globalThis, "__SS_WEBCHAT_STARTUP__", {
      configurable: true,
      value: {
        mark: (stage, extra) => {
          marks.push({ stage, extra });
        },
      },
    });
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: FakeWebSocket,
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: {
        protocol: "http:",
        host: "127.0.0.1:28889",
      },
    });

    try {
      let currentSocket = null;
      const feature = createChatNetworkFeature({
        refs: {
          statusEl: null,
          sendBtn: null,
          authModeEl: { value: "none" },
          authValueEl: { value: "" },
          workspaceRootsEl: { value: "" },
          userUuidEl: { value: "" },
          agentSelectEl: null,
          modelPickerEl: null,
          modelFilterEl: null,
          modelSelectEl: null,
        },
        keys: {
          storeKey: "store",
          sessionAuthTokenKey: "session-token",
          workspaceRootsKey: "roots",
          uuidKey: "uuid",
          agentIdKey: "agent",
          modelIdKey: "model",
          clientId: "client-1",
        },
        getTransientUrlToken: () => "",
        getSocket: () => currentSocket,
        setSocket: (value) => {
          currentSocket = value;
        },
        getReady: () => false,
        setReady: () => {},
        persistConnectionFields: () => {},
        setStatus: () => {},
        safeJsonParse: JSON.parse,
        makeId: () => "req-1",
      });

      feature.connect();

      expect(currentSocket).toBe(socket);
      expect(marks.map((item) => item.stage)).toEqual([
        "chat-network.connect.called",
        "chat-network.websocket.create",
      ]);
    } finally {
      if (previousStartup === undefined) {
        delete globalThis.__SS_WEBCHAT_STARTUP__;
      } else {
        Object.defineProperty(globalThis, "__SS_WEBCHAT_STARTUP__", {
          configurable: true,
          value: previousStartup,
        });
      }
      if (previousWebSocket === undefined) {
        delete globalThis.WebSocket;
      } else {
        Object.defineProperty(globalThis, "WebSocket", {
          configurable: true,
          value: previousWebSocket,
        });
      }
      if (previousLocation === undefined) {
        delete globalThis.location;
      } else {
        Object.defineProperty(globalThis, "location", {
          configurable: true,
          value: previousLocation,
        });
      }
    }
  });
});
