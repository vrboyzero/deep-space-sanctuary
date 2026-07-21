import { describe, expect, it, vi } from "vitest";

import {
  createDefaultWebChatRuntimeAdapter,
  createWebChatRuntimeContext,
} from "./webchat-runtime-context.js";

describe("webchat runtime context", () => {
  it("preserves the five legacy callback contracts through the default adapter", async () => {
    const requestResult = { ok: true };
    const sendReq = vi.fn().mockResolvedValue(requestResult);
    const isConnected = vi.fn(() => true);
    const switchMode = vi.fn(() => "memory");
    const t = vi.fn((_key, _params, fallback) => fallback);
    const showNotice = vi.fn(() => "notice-id");
    const getCurrentAgentSelection = vi.fn(() => "agent-1");
    const adapter = createDefaultWebChatRuntimeAdapter({
      sendReq,
      isConnected,
      switchMode,
      t,
      showNotice,
      getCurrentAgentSelection,
    });
    const context = createWebChatRuntimeContext({ adapter });
    const frame = { type: "req", method: "memory.stats" };
    const requestOptions = { signal: new AbortController().signal };

    await expect(context.gateway.request(frame, requestOptions)).resolves.toBe(requestResult);
    expect(context.gateway.isConnected()).toBe(true);
    expect(context.navigation.switchMode("memory")).toBe("memory");
    expect(context.locale.t("memory.title", { count: "1" }, "Memory")).toBe("Memory");
    expect(context.notice.show("Saved", "Done", "success", 1200, { key: "save" })).toBe("notice-id");
    expect(context.identity.getActiveAgentId()).toBe("agent-1");

    expect(sendReq).toHaveBeenCalledWith(frame, requestOptions);
    expect(switchMode).toHaveBeenCalledWith("memory");
    expect(t).toHaveBeenCalledWith("memory.title", { count: "1" }, "Memory");
    expect(showNotice).toHaveBeenCalledWith("Saved", "Done", "success", 1200, { key: "save" });
  });

  it("provides deterministic defaults when legacy callbacks are unavailable", async () => {
    const context = createWebChatRuntimeContext();

    await expect(context.gateway.request({ method: "missing" })).resolves.toBeNull();
    expect(context.gateway.isConnected()).toBe(false);
    expect(context.navigation.switchMode("memory")).toBe(false);
    expect(context.locale.t("missing.key", {}, "Fallback")).toBe("Fallback");
    expect(context.locale.t("missing.key")).toBe("missing.key");
    expect(context.notice.show("Title", "Message")).toBe(false);
    expect(context.identity.getActiveAgentId()).toBe("default");
  });

  it("replaces and disposes adapters without retaining the previous owner", async () => {
    const firstRequest = vi.fn().mockResolvedValue("first");
    const secondRequest = vi.fn().mockResolvedValue("second");
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const context = createWebChatRuntimeContext({
      adapter: {
        ...createDefaultWebChatRuntimeAdapter({ sendReq: firstRequest }),
        dispose: firstDispose,
      },
    });
    const retainedRequest = context.gateway.request;

    await expect(retainedRequest({ method: "first" })).resolves.toBe("first");
    expect(context.replaceAdapter({
      ...createDefaultWebChatRuntimeAdapter({ sendReq: secondRequest }),
      dispose: secondDispose,
    })).toBe(true);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    await expect(retainedRequest({ method: "second" })).resolves.toBe("second");
    expect(firstRequest).toHaveBeenCalledTimes(1);
    expect(secondRequest).toHaveBeenCalledTimes(1);
    expect(context.getRuntimeSnapshot()).toEqual({
      runtimeContextGeneration: 2,
      runtimeContextDisposed: false,
    });

    expect(context.dispose()).toBe(true);
    expect(context.dispose()).toBe(false);
    expect(context.replaceAdapter(createDefaultWebChatRuntimeAdapter())).toBe(false);
    expect(secondDispose).toHaveBeenCalledTimes(1);
    await expect(retainedRequest({ method: "disposed" })).resolves.toBeNull();
    expect(secondRequest).toHaveBeenCalledTimes(1);
    expect(context.getRuntimeSnapshot()).toEqual({
      runtimeContextGeneration: 3,
      runtimeContextDisposed: true,
    });
  });
});
