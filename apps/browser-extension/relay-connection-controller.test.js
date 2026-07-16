import { afterEach, describe, expect, it, vi } from "vitest";

import { RelayConnectionController } from "./relay-connection-controller.js";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

class FakeSocket {
  readyState = CONNECTING;
  onclose = null;
  onerror = null;
  onmessage = null;
  onopen = null;
  close = vi.fn(() => {
    this.readyState = CLOSED;
    this.onclose?.({ code: 1000 });
  });
  send = vi.fn();

  open() {
    this.readyState = OPEN;
    this.onopen?.();
  }

  emitClose() {
    this.readyState = CLOSED;
    this.onclose?.({ code: 1006 });
  }

  emitError() {
    this.onerror?.(new Error("relay unavailable"));
  }

  emitMessage(data) {
    this.onmessage?.({ data });
  }
}

function createFixture() {
  const sockets = [];
  const messages = [];
  const states = [];
  const attachDebuggerListeners = vi.fn();
  const detachDebuggerListeners = vi.fn();
  const controller = new RelayConnectionController({
    getConfig: vi.fn(async () => ({ port: 28892, token: "a".repeat(43) })),
    createSocket: vi.fn(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    }),
    attachDebuggerListeners,
    detachDebuggerListeners,
    onMessage: (data) => messages.push(data),
    onStateChange: (state) => states.push(state),
    reconnectBaseDelayMs: 100,
    reconnectJitterRatio: 0,
  });
  return {
    attachDebuggerListeners,
    controller,
    detachDebuggerListeners,
    messages,
    sockets,
    states,
  };
}

async function waitForSocket(sockets, expectedCount) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (sockets.length >= expectedCount) {
      return sockets[expectedCount - 1];
    }
    await Promise.resolve();
  }
  throw new Error(`Expected ${expectedCount} socket(s), received ${sockets.length}.`);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RelayConnectionController", () => {
  it("keeps one debugger listener registration and one reconnect timer across repeated close events", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const firstConnect = fixture.controller.start();
    const firstSocket = await waitForSocket(fixture.sockets, 1);
    firstSocket.open();
    await firstConnect;

    expect(fixture.attachDebuggerListeners).toHaveBeenCalledTimes(1);
    firstSocket.emitClose();
    firstSocket.emitClose();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    const secondSocket = await waitForSocket(fixture.sockets, 2);
    secondSocket.open();

    expect(fixture.attachDebuggerListeners).toHaveBeenCalledTimes(1);
    expect(fixture.detachDebuggerListeners).not.toHaveBeenCalled();
  });

  it("keeps one listener and one reconnect path through twenty successful Relay restarts", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const initialConnect = fixture.controller.start();
    let socket = await waitForSocket(fixture.sockets, 1);
    socket.open();
    await initialConnect;

    for (let restart = 1; restart <= 20; restart += 1) {
      socket.emitClose();
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      socket = await waitForSocket(fixture.sockets, restart + 1);
      socket.open();
      await Promise.resolve();
    }

    expect(fixture.sockets).toHaveLength(21);
    expect(fixture.attachDebuggerListeners).toHaveBeenCalledTimes(1);
    expect(fixture.detachDebuggerListeners).not.toHaveBeenCalled();
    expect(fixture.states.filter((state) => state === "connected")).toHaveLength(21);
  });

  it("ignores stale socket events after a forced reconnect", async () => {
    const fixture = createFixture();
    const firstConnect = fixture.controller.start();
    const firstSocket = await waitForSocket(fixture.sockets, 1);
    firstSocket.open();
    await firstConnect;

    const reconnect = fixture.controller.forceReconnect();
    const secondSocket = await waitForSocket(fixture.sockets, 2);
    firstSocket.emitClose();
    firstSocket.emitMessage("stale");
    secondSocket.open();
    await reconnect;
    secondSocket.emitMessage("current");

    expect(fixture.messages).toEqual(["current"]);
    expect(fixture.controller.send({ method: "ping" })).toBe(true);
    expect(secondSocket.send).toHaveBeenCalledWith(JSON.stringify({ method: "ping" }));
  });

  it("retries a failed connection once instead of retaining parallel retry loops", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const firstConnect = fixture.controller.start();
    const firstSocket = await waitForSocket(fixture.sockets, 1);
    firstSocket.emitError();
    await expect(firstConnect).rejects.toThrow("relay unavailable");
    firstSocket.emitClose();

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    const secondSocket = await waitForSocket(fixture.sockets, 2);
    secondSocket.open();

    expect(fixture.states.filter((state) => state === "connecting")).toHaveLength(2);
  });

  it("disposes its socket, retry timer, and debugger listeners", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const connect = fixture.controller.start();
    const socket = await waitForSocket(fixture.sockets, 1);
    socket.open();
    await connect;

    fixture.controller.dispose();
    socket.emitClose();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(fixture.detachDebuggerListeners).toHaveBeenCalledTimes(1);
    expect(fixture.controller.send({ method: "ping" })).toBe(false);
    expect(fixture.sockets).toHaveLength(1);
  });
});
