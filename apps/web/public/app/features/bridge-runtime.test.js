// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridgeRuntimeFeature } from "./bridge-runtime.js";

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness(sendReqImpl = vi.fn(), options = {}) {
  document.body.innerHTML = `
    <section id="bridgeSection">
      <div id="bridgeSummary"></div>
      <aside id="bridgeList"></aside>
      <section id="bridgeDetail"></section>
      <button id="bridgeRefresh"></button>
    </section>
  `;

  const refs = {
    bridgeSection: document.getElementById("bridgeSection"),
    bridgeSummaryEl: document.getElementById("bridgeSummary"),
    bridgeListEl: document.getElementById("bridgeList"),
    bridgeDetailEl: document.getElementById("bridgeDetail"),
    bridgeRefreshBtn: document.getElementById("bridgeRefresh"),
  };

  const state = {
    items: [],
    totalCount: 0,
    activeCount: 0,
    closedCount: 0,
    selectedSessionId: null,
    selectedSession: null,
    selectedPeek: null,
    loadSeq: 0,
    detailSeq: 0,
    loading: false,
    detailLoading: false,
    viewActive: false,
  };

  const sendReq = typeof sendReqImpl === "function" ? sendReqImpl : vi.fn(sendReqImpl);
  const onOpenSourcePath = vi.fn();
  const onOpenTask = vi.fn(async () => {});

  const feature = createBridgeRuntimeFeature({
    refs,
    isConnected: () => true,
    sendReq,
    makeId: (() => {
      let seq = 0;
      return () => `req-${++seq}`;
    })(),
    getBridgeRuntimeState: () => state,
    escapeHtml: options.escapeHtml || ((value) => String(value ?? "")),
    formatDateTime: (value) => String(value ?? "-"),
    onOpenSourcePath,
    onOpenTask,
    showNotice: vi.fn(),
    t: (_key, _params, fallback) => fallback ?? "",
  });

  return {
    refs,
    state,
    sendReq,
    onOpenSourcePath,
    onOpenTask,
    feature,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("bridge runtime feature", () => {
  it("renders Gateway list errors as empty-state text without parsing HTML", async () => {
    const maliciousError = '<img src=x onerror="alert(1)">bridge list failed';
    const { refs, feature } = createHarness(
      vi.fn(async () => ({ ok: false, error: { message: maliciousError } })),
      {
        escapeHtml(value) {
          if (value === maliciousError) {
            throw new Error("Bridge error placeholders must not require an HTML escaper");
          }
          return String(value ?? "");
        },
      },
    );

    await expect(feature.loadBridgeSessions()).resolves.toBeUndefined();

    for (const root of [refs.bridgeListEl, refs.bridgeDetailEl]) {
      expect(root.children).toHaveLength(1);
      expect(root.firstElementChild.className).toBe("memory-viewer-empty");
      expect(root.firstElementChild.textContent).toBe(maliciousError);
      expect(root.querySelector("img, [onerror]")).toBeNull();
    }
    feature.dispose();
  });

  it("owns polling across activate, deactivate, and dispose", async () => {
    vi.useFakeTimers();
    const sendReq = vi.fn(async (req) => {
      if (req.method === "bridge.session.list") {
        return {
          ok: true,
          payload: { items: [], totalCount: 0, activeCount: 0, closedCount: 0 },
        };
      }
      throw new Error(`unexpected request ${req.method}`);
    });
    const { refs, state, feature } = createHarness(sendReq);

    feature.setViewActive(true);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      viewActive: true,
      polling: true,
      disposed: false,
    });
    expect(sendReq).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(sendReq).toHaveBeenCalledTimes(2);

    feature.setViewActive(false);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      viewActive: false,
      polling: false,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sendReq).toHaveBeenCalledTimes(2);

    feature.setViewActive(true);
    expect(sendReq).toHaveBeenCalledTimes(3);
    feature.dispose();
    expect(state.viewActive).toBe(false);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      viewActive: false,
      polling: false,
      disposed: true,
    });

    refs.bridgeRefreshBtn.click();
    feature.setViewActive(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendReq).toHaveBeenCalledTimes(3);
  });

  it("ignores a late list response after dispose", async () => {
    let resolveList;
    const sendReq = vi.fn(() => new Promise((resolve) => {
      resolveList = resolve;
    }));
    const { state, feature } = createHarness(sendReq);

    feature.setViewActive(true);
    feature.dispose();
    resolveList({
      ok: true,
      payload: {
        items: [{ sessionId: "late-session", status: "active" }],
        totalCount: 1,
        activeCount: 1,
        closedCount: 0,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(state.items).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("loads bridge sessions, switches details, and exposes task/source actions", async () => {
    const session1 = {
      sessionId: "session-1",
      taskId: "task-1",
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: "E:/project/openclaw",
      commandPreview: "codex --sandbox workspace-write --add-dir E:/project/openclaw",
      cols: 80,
      rows: 24,
      status: "active",
      createdAt: 1710000000000,
      updatedAt: 1710000001000,
      transcriptEventCount: 1,
      latestOutputPreview: "first output",
      hasBufferedOutput: true,
      bufferedOutputChars: 42,
      transcriptPath: "state/bridge/session-1/transcript.json",
      artifactPath: "state/bridge/session-1/summary.json",
      firstTurnHint: "Use bridge_session_start.prompt first.",
    };
    const session2 = {
      sessionId: "session-2",
      taskId: "task-2",
      targetId: "claude_code_session",
      action: "interactive",
      transport: "pty",
      cwd: "E:/project/UI-TARS-desktop-main",
      commandPreview: "claude --dangerously-skip-permissions --add-dir E:/project/UI-TARS-desktop-main",
      cols: 80,
      rows: 24,
      status: "active",
      createdAt: 1710000002000,
      updatedAt: 1710000003000,
      transcriptEventCount: 2,
      latestOutputPreview: "second output",
      hasBufferedOutput: false,
      bufferedOutputChars: 0,
      transcriptPath: "state/bridge/session-2/transcript.json",
      artifactPath: "state/bridge/session-2/summary.json",
    };

    const sendReq = vi.fn(async (req) => {
      if (req.method === "bridge.session.list") {
        return {
          ok: true,
          payload: {
            items: [session2, session1],
            totalCount: 2,
            activeCount: 2,
            closedCount: 0,
          },
        };
      }
      if (req.method === "bridge.session.peek" && req.params.sessionId === "session-2") {
        return {
          ok: true,
          payload: {
            session: session2,
            liveOutput: "claude live buffer\nline 2",
            transcriptTail: [
              {
                direction: "input",
                timestamp: 1710000002001,
                content: "inspect the bootstrap flow\n",
              },
            ],
            transcriptEventCount: 1,
          },
        };
      }
      if (req.method === "bridge.session.peek" && req.params.sessionId === "session-1") {
        return {
          ok: true,
          payload: {
            session: session1,
            liveOutput: "codex live buffer\nready",
            transcriptTail: [
              {
                direction: "system",
                timestamp: 1710000001001,
                content: "session attached\n",
              },
              {
                direction: "output",
                timestamp: 1710000001002,
                content: "first output\n",
              },
            ],
            transcriptEventCount: 2,
          },
        };
      }
      throw new Error(`unexpected request ${req.method}`);
    });

    const {
      refs,
      state,
      onOpenSourcePath,
      onOpenTask,
      feature,
    } = createHarness(sendReq);

    await feature.loadBridgeSessions(true);

    expect(state.selectedSessionId).toBe("session-2");
    expect(refs.bridgeSummaryEl.textContent).toContain("2");
    expect(refs.bridgeListEl.textContent).toContain("claude_code_session.interactive");
    expect(refs.bridgeListEl.textContent).toContain("codex_session.interactive");
    expect(refs.bridgeDetailEl.textContent).toContain("claude live buffer");
    expect(refs.bridgeDetailEl.textContent).toContain("inspect the bootstrap flow");

    const sessionButtons = refs.bridgeListEl.querySelectorAll("[data-bridge-session-id]");
    expect(sessionButtons).toHaveLength(2);
    sessionButtons[1].click();
    await flushPromises();

    expect(state.selectedSessionId).toBe("session-1");
    expect(refs.bridgeDetailEl.textContent).toContain("codex live buffer");
    expect(refs.bridgeDetailEl.textContent).toContain("session attached");
    expect(refs.bridgeDetailEl.textContent).toContain("first output");

    refs.bridgeDetailEl.querySelector("[data-bridge-open-task]")?.dispatchEvent(new Event("click"));
    expect(onOpenTask).toHaveBeenCalledWith("task-1");

    const openSourceButtons = refs.bridgeDetailEl.querySelectorAll("[data-open-source]");
    openSourceButtons[0]?.dispatchEvent(new Event("click"));
    openSourceButtons[1]?.dispatchEvent(new Event("click"));
    expect(onOpenSourcePath).toHaveBeenNthCalledWith(1, "state/bridge/session-1/transcript.json");
    expect(onOpenSourcePath).toHaveBeenNthCalledWith(2, "state/bridge/session-1/summary.json");
  });
});
