// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridgeRuntimeFeature } from "./bridge-runtime.js";

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Bridge session list DOM rendering", () => {
  it("renders rows and preserves selection without using the HTML parser", async () => {
    document.body.innerHTML = `
      <section id="bridgeSection">
        <div id="bridgeSummary"></div>
        <aside id="bridgeList"></aside>
        <section id="bridgeDetail"></section>
        <button id="bridgeRefresh"></button>
      </section>
    `;
    const list = document.getElementById("bridgeList");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(list, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Bridge session list must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const firstSession = {
      sessionId: 'session-" onclick="alert(1)',
      targetId: '<img src=x onerror="alert(2)">target',
      action: "interactive<script>alert(3)</script>",
      status: "active",
      cwd: "<iframe src=javascript:alert(4)>cwd</iframe>",
      taskId: "<b>task-1</b>",
      hasBufferedOutput: true,
      latestOutputPreview: "<svg onload=alert(5)>preview</svg>",
    };
    const secondSession = {
      sessionId: "session-2",
      targetId: "codex_session",
      action: "interactive",
      status: "closed",
      cwd: "E:/project/star-sanctuary",
      taskId: null,
      hasBufferedOutput: false,
      latestOutputPreview: "done",
    };
    const state = {
      items: [firstSession, secondSession],
      totalCount: 2,
      activeCount: 1,
      closedCount: 1,
      selectedSessionId: firstSession.sessionId,
      selectedSession: null,
      selectedPeek: null,
      loadSeq: 0,
      detailSeq: 0,
      loading: false,
      detailLoading: false,
      viewActive: true,
    };
    const sendReq = vi.fn(async () => ({
      ok: false,
      error: { message: "detail unavailable" },
    }));
    const labels = {
      "bridge.statusActive": '<svg onload="alert(6)">active</svg>',
      "bridge.statusClosed": "<script>alert(7)</script>closed",
      "bridge.bufferedBadge": '<img src=x onerror="alert(8)">buffered',
    };
    const feature = createBridgeRuntimeFeature({
      refs: {
        bridgeSection: document.getElementById("bridgeSection"),
        bridgeSummaryEl: document.getElementById("bridgeSummary"),
        bridgeListEl: list,
        bridgeDetailEl: document.getElementById("bridgeDetail"),
        bridgeRefreshBtn: document.getElementById("bridgeRefresh"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "req-1",
      getBridgeRuntimeState: () => state,
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      onOpenSourcePath: vi.fn(),
      onOpenTask: vi.fn(async () => {}),
      showNotice: vi.fn(),
      t: (key, _params, fallback) => labels[key] ?? fallback ?? "",
    });

    expect(() => feature.refreshLocale()).not.toThrow();

    let rows = [...list.querySelectorAll(":scope > .memory-list-item")];
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains("active")).toBe(true);
    expect(rows[1].classList.contains("active")).toBe(false);
    expect(rows[0].getAttribute("data-bridge-session-id")).toBe(firstSession.sessionId);
    expect(rows[0].querySelector(".memory-list-item-title")?.textContent).toBe(
      `${firstSession.targetId}.${firstSession.action}`,
    );
    expect([...rows[0].querySelectorAll(".memory-badge")].map((badge) => badge.textContent)).toEqual([
      labels["bridge.statusActive"],
      `task:${firstSession.taskId}`,
      labels["bridge.bufferedBadge"],
    ]);
    expect(rows[0].querySelector(".memory-list-item-meta > span")?.textContent).toBe(firstSession.cwd);
    expect(rows[0].querySelector(".memory-list-item-snippet")?.textContent).toBe(firstSession.latestOutputPreview);
    expect([...rows[1].querySelectorAll(".memory-badge")].map((badge) => badge.textContent)).toEqual([
      labels["bridge.statusClosed"],
    ]);
    expect(list.querySelector("img, svg, script, iframe, b, [onerror], [onload], [onclick]")).toBeNull();

    rows[1].click();
    await flushPromises();

    expect(state.selectedSessionId).toBe(secondSession.sessionId);
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "bridge.session.peek",
      params: expect.objectContaining({ sessionId: secondSession.sessionId }),
    }));
    rows = [...list.querySelectorAll(":scope > .memory-list-item")];
    expect(rows[1].classList.contains("active")).toBe(true);
    feature.dispose();
  });
});
