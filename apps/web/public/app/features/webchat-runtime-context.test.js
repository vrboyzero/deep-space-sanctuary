import { describe, expect, it, vi } from "vitest";

import {
  createDefaultWebChatRuntimeAdapter,
  createWebChatRuntimeContext,
} from "./webchat-runtime-context.js";
import { parseTaskProjectionCollectionPage } from "./task-projection-webchat.js";

function createProjection() {
  const capabilities = Object.fromEntries([
    "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal", "trace", "verifier", "mcp", "plugin", "skill",
  ].map((name) => [name, { required: false, state: "available" }]));
  return {
    schemaVersion: "task-projection/v1",
    taskId: "task-1",
    status: "running",
    owner: { source: "conversation", binding: { agentRunId: "run-1", conversationId: "conversation-1" } },
    evidence: { observedAtMs: 1, reasonCategory: "running", reasonCode: "owner_running" },
    allowedActions: ["observe", "cancel"],
    capabilityClosure: { schemaVersion: "task-capability-closure/v1", evaluatedAtMs: 1, status: "satisfied", capabilities },
  };
}

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

  it("exposes a read-only TaskProjection page adapter without changing legacy gateway requests", async () => {
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { epoch: "epoch-1", revision: 2, totalCount: 0, items: [] },
    });
    const context = createWebChatRuntimeContext({ adapter: createDefaultWebChatRuntimeAdapter({ sendReq }) });
    await expect(context.taskProjections.list({ limit: 10 })).resolves.toEqual({
      ok: true,
      payload: { epoch: "epoch-1", revision: 2, totalCount: 0, items: [] },
    });
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      method: "task.projection.list",
      params: { limit: 10 },
    }, {});
  });

  it("fails closed before Gateway dispatch for unsupported projection fields", async () => {
    const sendReq = vi.fn();
    const context = createWebChatRuntimeContext({ adapter: createDefaultWebChatRuntimeAdapter({ sendReq }) });
    await expect(context.taskProjections.list({ prompt: "forbidden" })).rejects.toThrow("unsupported fields");
    expect(sendReq).not.toHaveBeenCalled();
  });

  it("keeps page parsing strict for required fields and revision-bound cursors", () => {
    const page = parseTaskProjectionCollectionPage({ epoch: "epoch-1", revision: 2, totalCount: 1, items: [createProjection()] });
    expect(page.items[0].taskId).toBe("task-1");
    expect(() => parseTaskProjectionCollectionPage({ epoch: "epoch-1", revision: 2, totalCount: 1 }))
      .toThrow("invalid");
    expect(() => parseTaskProjectionCollectionPage({
      epoch: "epoch-1",
      revision: 2,
      totalCount: 1,
      items: [createProjection()],
      nextCursor: { epoch: "epoch-1", revision: 2, offset: 0 },
    })).toThrow("cursor");
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
