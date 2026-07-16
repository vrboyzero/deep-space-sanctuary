// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { consumeSessionAuthHandoff, createSessionAuthHandoffUrl } from "./session-auth-handoff.js";

class FakeBroadcastChannel {
  static channels = new Map();

  static reset() {
    FakeBroadcastChannel.channels.clear();
  }

  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    this.closed = false;
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set();
    channels.add(this);
    FakeBroadcastChannel.channels.set(name, channels);
  }

  addEventListener(type, listener) {
    if (type === "message") this.listeners.add(listener);
  }

  postMessage(data) {
    const peers = [...(FakeBroadcastChannel.channels.get(this.name) ?? [])]
      .filter((channel) => channel !== this);
    queueMicrotask(() => {
      if (this.closed) return;
      for (const peer of peers) {
        for (const listener of peer.listeners) {
          listener({ data });
        }
      }
    });
  }

  close() {
    this.closed = true;
    const channels = FakeBroadcastChannel.channels.get(this.name);
    channels?.delete(this);
    if (channels?.size === 0) FakeBroadcastChannel.channels.delete(this.name);
    this.listeners.clear();
  }
}

describe("session auth handoff", () => {
  beforeEach(() => {
    FakeBroadcastChannel.reset();
    globalThis.BroadcastChannel = FakeBroadcastChannel;
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  it("creates a multi-page url with a nonce without storing the token locally", () => {
    const nextUrl = createSessionAuthHandoffUrl({
      currentUrl: "http://127.0.0.1:28889/?foo=1",
      authMode: "token",
      authValue: "runtime-token",
      now: 1000,
      idFactory: () => "handoff-1",
    });

    expect(nextUrl).toBe("http://127.0.0.1:28889/?foo=1&authHandoff=handoff-1");
    expect(localStorage.getItem("belldandy.webchat.authHandoff.handoff-1")).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toContain("runtime-token");
  });

  it("uses Web Crypto for the default handoff nonce", () => {
    const previousCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: () => "secure-handoff-nonce" },
    });

    try {
      const nextUrl = createSessionAuthHandoffUrl({
        currentUrl: "http://127.0.0.1:28889/",
        authMode: "token",
        authValue: "runtime-token",
        now: 1000,
      });

      expect(nextUrl).toBe("http://127.0.0.1:28889/?authHandoff=secure-handoff-nonce");
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: previousCrypto,
      });
    }
  });

  it("consumes a one-time in-memory handoff and removes its query nonce", async () => {
    const nextUrl = createSessionAuthHandoffUrl({
      currentUrl: "http://127.0.0.1:28889/?foo=1",
      authMode: "token",
      authValue: "runtime-token-2",
      now: 1000,
      idFactory: () => "handoff-2",
    });
    const targetUrl = new URL(nextUrl);
    history.replaceState({}, "", `${targetUrl.pathname}${targetUrl.search}`);

    const result = await consumeSessionAuthHandoff({ now: 1200, waitMs: 50 });

    expect(result).toEqual({ mode: "token", value: "runtime-token-2" });
    expect(localStorage.length).toBe(0);
    expect(window.location.search).toBe("?foo=1");

    history.replaceState({}, "", "/?authHandoff=handoff-2");
    await expect(consumeSessionAuthHandoff({ now: 1200, waitMs: 1 })).resolves.toBeNull();
  });

  it("cleans every legacy handoff even when the current url has no nonce", async () => {
    localStorage.setItem("belldandy.webchat.authHandoff.expired", JSON.stringify({
      mode: "token",
      value: "expired-token",
      createdAt: 1,
    }));
    localStorage.setItem("belldandy.webchat.authHandoff.unused", JSON.stringify({
      mode: "token",
      value: "unused-token",
      createdAt: 1000,
    }));
    localStorage.setItem("unrelated", "keep-me");

    await consumeSessionAuthHandoff({ now: 1200, waitMs: 1 });

    expect(localStorage.getItem("belldandy.webchat.authHandoff.expired")).toBeNull();
    expect(localStorage.getItem("belldandy.webchat.authHandoff.unused")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep-me");
  });
});
