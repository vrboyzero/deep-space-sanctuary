// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridgeRuntimeFeature } from "./bridge-runtime.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Bridge loading summary DOM rendering", () => {
  it("renders the disconnected stat and empty states without using the HTML parser", () => {
    document.body.innerHTML = `
      <section id="bridgeSection">
        <div id="bridgeSummary"></div>
        <aside id="bridgeList"></aside>
        <section id="bridgeDetail"></section>
        <button id="bridgeRefresh"></button>
      </section>
    `;
    const summary = document.getElementById("bridgeSummary");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(summary, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Bridge loading summary must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const maliciousLabel = '<img src=x onerror="alert(1)">桥接会话';
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
    const feature = createBridgeRuntimeFeature({
      refs: {
        bridgeSection: document.getElementById("bridgeSection"),
        bridgeSummaryEl: summary,
        bridgeListEl: document.getElementById("bridgeList"),
        bridgeDetailEl: document.getElementById("bridgeDetail"),
        bridgeRefreshBtn: document.getElementById("bridgeRefresh"),
      },
      isConnected: () => false,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      getBridgeRuntimeState: () => state,
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      onOpenSourcePath: vi.fn(),
      onOpenTask: vi.fn(async () => {}),
      showNotice: vi.fn(),
      t: (key, _params, fallback) => key === "bridge.statSessions" ? maliciousLabel : fallback ?? "",
    });

    expect(() => feature.refreshLocale()).not.toThrow();

    expect(summary.children).toHaveLength(1);
    expect(summary.firstElementChild.className).toBe("memory-stat-card");
    expect(summary.querySelector(".memory-stat-label").textContent).toBe(maliciousLabel);
    expect(summary.querySelector(".memory-stat-value").textContent).toBe("--");
    expect(summary.querySelector("img, [onerror]")).toBeNull();
    expect(document.getElementById("bridgeList").textContent).toBe("未连接");
    expect(document.getElementById("bridgeDetail").textContent).toBe("未连接");
    feature.dispose();
  });

  it("renders the connected summary stats without using the HTML parser", () => {
    document.body.innerHTML = `
      <section id="bridgeSection">
        <div id="bridgeSummary"></div>
        <aside id="bridgeList"></aside>
        <section id="bridgeDetail"></section>
        <button id="bridgeRefresh"></button>
      </section>
    `;
    const summary = document.getElementById("bridgeSummary");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(summary, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Bridge connected summary must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const labels = {
      "bridge.statSessions": '<img src=x onerror="alert(1)">sessions',
      "bridge.statActive": '<svg onload="alert(2)">active</svg>',
      "bridge.statClosed": "<script>alert(3)</script>closed",
    };
    const state = {
      items: [],
      totalCount: 7,
      activeCount: 0,
      closedCount: 7,
      selectedSessionId: null,
      selectedSession: null,
      selectedPeek: null,
      loadSeq: 0,
      detailSeq: 0,
      loading: false,
      detailLoading: false,
      viewActive: true,
    };
    const feature = createBridgeRuntimeFeature({
      refs: {
        bridgeSection: document.getElementById("bridgeSection"),
        bridgeSummaryEl: summary,
        bridgeListEl: document.getElementById("bridgeList"),
        bridgeDetailEl: document.getElementById("bridgeDetail"),
        bridgeRefreshBtn: document.getElementById("bridgeRefresh"),
      },
      isConnected: () => true,
      sendReq: vi.fn(),
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

    const cards = [...summary.querySelectorAll(":scope > .memory-stat-card")];
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.querySelector(".memory-stat-label")?.textContent)).toEqual([
      labels["bridge.statSessions"],
      labels["bridge.statActive"],
      labels["bridge.statClosed"],
    ]);
    expect(cards.map((card) => card.querySelector(".memory-stat-value")?.textContent)).toEqual([
      "7",
      "0",
      "7",
    ]);
    expect(summary.querySelector("img, svg, script, [onerror], [onload]")).toBeNull();
    feature.dispose();
  });
});
