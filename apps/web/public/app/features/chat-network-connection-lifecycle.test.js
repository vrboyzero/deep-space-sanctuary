import { describe, expect, it } from "vitest";

import { createChatNetworkConnectionLifecycle } from "./chat-network-connection-lifecycle.js";

function createSocketHarness() {
  const listeners = new Map();
  const retainedListeners = new Map();
  const socket = {
    closeCalls: 0,
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? new Set();
      registered.add(listener);
      listeners.set(type, registered);
      retainedListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      const registered = listeners.get(type);
      registered?.delete(listener);
      if (registered?.size === 0) listeners.delete(type);
    },
    close() {
      this.closeCalls += 1;
    },
    dispatch(type, event = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener(event);
      }
    },
    getListener(type) {
      return retainedListeners.get(type);
    },
    getListenerCount() {
      let count = 0;
      for (const registered of listeners.values()) count += registered.size;
      return count;
    },
  };
  return socket;
}

function createTimerHarness() {
  let nextHandle = 0;
  const timers = new Map();
  return {
    schedule(callback, delayMs) {
      const handle = ++nextHandle;
      timers.set(handle, { callback, delayMs });
      return handle;
    },
    cancel(handle) {
      timers.delete(handle);
    },
    runNext() {
      const entry = timers.entries().next().value;
      if (!entry) return false;
      const [handle, timer] = entry;
      timers.delete(handle);
      timer.callback();
      return true;
    },
    get count() {
      return timers.size;
    },
    get delays() {
      return [...timers.values()].map((timer) => timer.delayMs);
    },
  };
}

function createLifecycle(timerHarness) {
  return createChatNetworkConnectionLifecycle({
    scheduleReconnect: timerHarness.schedule,
    cancelReconnect: timerHarness.cancel,
    random: () => 0.5,
  });
}

describe("chat network connection lifecycle", () => {
  it("backs off consecutive reconnects exponentially up to the hard cap", () => {
    const timerHarness = createTimerHarness();
    const lifecycle = createChatNetworkConnectionLifecycle({
      scheduleReconnect: timerHarness.schedule,
      cancelReconnect: timerHarness.cancel,
      reconnectDelayMs: 3_000,
      maxReconnectDelayMs: 30_000,
      reconnectJitterRatio: 0.2,
      random: () => 0.5,
    });
    const scheduledDelays = [];

    for (let generation = 1; generation <= 6; generation += 1) {
      const socket = createSocketHarness();
      lifecycle.replaceConnection({
        socket,
        generation,
        onClose: () => true,
      });
      socket.dispatch("close", { code: 1006 });
      scheduledDelays.push(timerHarness.delays[0]);
      timerHarness.runNext();
    }

    expect(scheduledDelays).toEqual([3_000, 6_000, 12_000, 24_000, 30_000, 30_000]);
  });

  it("resets reconnect backoff after a connection becomes ready", () => {
    const timerHarness = createTimerHarness();
    const lifecycle = createChatNetworkConnectionLifecycle({
      scheduleReconnect: timerHarness.schedule,
      cancelReconnect: timerHarness.cancel,
      random: () => 0.5,
    });
    const scheduledDelays = [];

    for (let generation = 1; generation <= 2; generation += 1) {
      const socket = createSocketHarness();
      lifecycle.replaceConnection({ socket, generation, onClose: () => true });
      socket.dispatch("close", { code: 1006 });
      scheduledDelays.push(timerHarness.delays[0]);
      timerHarness.runNext();
    }

    lifecycle.resetReconnectBackoff();
    const readySocket = createSocketHarness();
    lifecycle.replaceConnection({ socket: readySocket, generation: 3, onClose: () => true });
    readySocket.dispatch("close", { code: 1006 });
    scheduledDelays.push(timerHarness.delays[0]);

    expect(scheduledDelays).toEqual([3_000, 6_000, 3_000]);
  });

  it("applies bounded jitter without exceeding the reconnect hard cap", () => {
    function getFirstDelay({ reconnectDelayMs = 3_000, random }) {
      const timerHarness = createTimerHarness();
      const lifecycle = createChatNetworkConnectionLifecycle({
        scheduleReconnect: timerHarness.schedule,
        cancelReconnect: timerHarness.cancel,
        reconnectDelayMs,
        maxReconnectDelayMs: 30_000,
        reconnectJitterRatio: 0.2,
        random,
      });
      const socket = createSocketHarness();
      lifecycle.replaceConnection({ socket, generation: 1, onClose: () => true });
      socket.dispatch("close", { code: 1006 });
      return timerHarness.delays[0];
    }

    expect(getFirstDelay({ random: () => 0 })).toBe(2_400);
    expect(getFirstDelay({ random: () => 1 })).toBe(3_600);
    expect(getFirstDelay({ reconnectDelayMs: 30_000, random: () => 1 })).toBe(30_000);
  });

  it("reports the actual delay after a reconnect timer is scheduled", () => {
    const timerHarness = createTimerHarness();
    const lifecycle = createLifecycle(timerHarness);
    const socket = createSocketHarness();
    const scheduled = [];

    lifecycle.replaceConnection({
      socket,
      generation: 1,
      onClose: () => true,
      onReconnectScheduled: (event) => scheduled.push(event),
    });
    socket.dispatch("close", { code: 1006 });

    expect(scheduled).toEqual([{ delayMs: 3_000 }]);
  });

  it("forwards active socket events and handles close only once", () => {
    const timerHarness = createTimerHarness();
    const lifecycle = createLifecycle(timerHarness);
    const socket = createSocketHarness();
    const events = [];

    lifecycle.replaceConnection({
      socket,
      generation: 1,
      onOpen: () => events.push("open"),
      onError: () => events.push("error"),
      onMessage: (event) => events.push(`message:${event.data}`),
      onClose: () => {
        events.push("close");
        return true;
      },
      onRelease: ({ generation }) => events.push(`release:${generation}`),
      onReconnect: () => events.push("reconnect"),
    });

    const retainedClose = socket.getListener("close");
    socket.dispatch("open");
    socket.dispatch("error");
    socket.dispatch("message", { data: "hello" });
    socket.dispatch("close", { code: 1006 });
    retainedClose({ code: 1006 });

    expect(events).toEqual(["open", "error", "message:hello", "release:1", "close"]);
    expect(socket.getListenerCount()).toBe(0);
    expect(timerHarness.count).toBe(1);
    expect(timerHarness.delays).toEqual([3000]);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: false,
      activeChatNetworkConnectionCount: 0,
      activeChatNetworkSocketListenerCount: 0,
      activeChatNetworkReconnectTimerCount: 1,
    });

    timerHarness.runNext();
    expect(events.at(-1)).toBe("reconnect");
  });

  it("replaces the socket generation and ignores retained handlers from the old socket", () => {
    const timerHarness = createTimerHarness();
    const lifecycle = createLifecycle(timerHarness);
    const oldSocket = createSocketHarness();
    const currentSocket = createSocketHarness();
    const messages = [];
    const releases = [];

    lifecycle.replaceConnection({
      socket: oldSocket,
      generation: 1,
      onMessage: () => messages.push("old"),
      onRelease: ({ generation }) => releases.push(generation),
    });
    const retainedOldMessage = oldSocket.getListener("message");

    lifecycle.replaceConnection({
      socket: currentSocket,
      generation: 2,
      onMessage: () => messages.push("current"),
      onRelease: ({ generation }) => releases.push(generation),
    });
    retainedOldMessage({ data: "late" });
    currentSocket.dispatch("message", { data: "current" });

    expect(oldSocket.closeCalls).toBe(1);
    expect(oldSocket.getListenerCount()).toBe(0);
    expect(currentSocket.getListenerCount()).toBe(4);
    expect(messages).toEqual(["current"]);
    expect(releases).toEqual([1]);
  });

  it("cancels a scheduled reconnect when a new generation is bound", () => {
    const timerHarness = createTimerHarness();
    const lifecycle = createLifecycle(timerHarness);
    const oldSocket = createSocketHarness();
    const currentSocket = createSocketHarness();
    let reconnectCalls = 0;

    lifecycle.replaceConnection({
      socket: oldSocket,
      generation: 1,
      onClose: () => true,
      onReconnect: () => {
        reconnectCalls += 1;
      },
    });
    oldSocket.dispatch("close", { code: 1006 });
    expect(timerHarness.count).toBe(1);

    lifecycle.replaceConnection({ socket: currentSocket, generation: 2 });

    expect(timerHarness.count).toBe(0);
    expect(timerHarness.runNext()).toBe(false);
    expect(reconnectCalls).toBe(0);
  });

  it("does not schedule reconnect when the close policy rejects it", () => {
    const timerHarness = createTimerHarness();
    const lifecycle = createLifecycle(timerHarness);
    const socket = createSocketHarness();

    lifecycle.replaceConnection({
      socket,
      generation: 1,
      onClose: () => false,
      onReconnect: () => {
        throw new Error("unexpected reconnect");
      },
    });
    socket.dispatch("close", { code: 4403 });

    expect(timerHarness.count).toBe(0);
  });

  it("unbinds the socket and prevents late dispatch or reconnect after dispose", () => {
    const timerHarness = createTimerHarness();
    const lifecycle = createLifecycle(timerHarness);
    const socket = createSocketHarness();
    const events = [];

    lifecycle.replaceConnection({
      socket,
      generation: 1,
      onOpen: () => events.push("open"),
      onClose: () => true,
      onMessage: () => events.push("message"),
      onReconnect: () => events.push("reconnect"),
    });
    const retainedOpen = socket.getListener("open");
    const retainedClose = socket.getListener("close");
    const retainedMessage = socket.getListener("message");

    lifecycle.dispose();
    retainedOpen({});
    retainedClose({ code: 1006 });
    retainedMessage({ data: "late" });

    expect(events).toEqual([]);
    expect(socket.closeCalls).toBe(1);
    expect(socket.getListenerCount()).toBe(0);
    expect(timerHarness.count).toBe(0);
    expect(lifecycle.replaceConnection({
      socket: createSocketHarness(),
      generation: 2,
    })).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      activeChatNetworkConnectionCount: 0,
      activeChatNetworkSocketListenerCount: 0,
      activeChatNetworkReconnectTimerCount: 0,
    });
  });
});
