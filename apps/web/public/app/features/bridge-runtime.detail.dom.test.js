// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridgeRuntimeFeature } from "./bridge-runtime.js";

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Bridge session detail DOM rendering", () => {
  it("renders fields and actions without using the HTML parser", async () => {
    document.body.innerHTML = `
      <section id="bridgeSection">
        <div id="bridgeSummary"></div>
        <aside id="bridgeList"></aside>
        <section id="bridgeDetail"></section>
        <button id="bridgeRefresh"></button>
      </section>
    `;
    const detail = document.getElementById("bridgeDetail");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(detail, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Bridge session detail must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const session = {
      sessionId: 'session-" onclick="alert(1)',
      targetId: '<img src=x onerror="alert(2)">target',
      action: "interactive<script>alert(3)</script>",
      status: "active",
      closeReason: "manual",
      taskId: "<b>task-1</b>",
      cwd: "<iframe src=javascript:alert(4)>cwd</iframe>",
      bufferedOutputChars: 0,
      updatedAt: 1710000000000,
      commandPreview: "<svg onload=alert(5)>command</svg>",
      firstTurnHint: "<style>body{display:none}</style>hint",
      transcriptPath: 'state/<img src=x onerror="alert(6)">transcript.json',
      artifactPath: "state/<script>alert(7)</script>artifact.json",
    };
    const peek = {
      session,
      transcriptTail: [
        {
          direction: "input",
          timestamp: 1710000000001,
          content: "<img src=x onerror=alert(8)>input\n",
        },
        {
          direction: "output",
          timestamp: 1710000000002,
          content: "<script>alert(9)</script>output\n",
        },
      ],
      liveOutput: "<svg onload=alert(10)>live</svg>\n",
    };
    const state = {
      items: [],
      totalCount: 1,
      activeCount: 1,
      closedCount: 0,
      selectedSessionId: session.sessionId,
      selectedSession: session,
      selectedPeek: peek,
      loadSeq: 0,
      detailSeq: 0,
      loading: false,
      detailLoading: false,
      viewActive: true,
    };
    const sendReq = vi.fn(async () => ({ ok: true, payload: peek }));
    const onOpenSourcePath = vi.fn();
    const onOpenTask = vi.fn(async () => {});
    const labels = {
      "bridge.detailTitle": '<img src=x onerror="alert(11)">Bridge Session',
      "bridge.detailTarget": "<script>alert(12)</script>Target",
      "bridge.statusActive": '<svg onload="alert(13)">Active</svg>',
      "bridge.closeReasonManual": "<style>bad</style>manual",
      "bridge.detailOutput": '<iframe src="javascript:alert(14)">Live Tail</iframe>',
      "bridge.openTask": "<b>Open task</b>",
      "bridge.openTranscript": "<img src=x>Open transcript",
      "bridge.openArtifact": "<svg>Open artifact</svg>",
      "bridge.refreshSession": "<script>Refresh</script>",
    };
    const feature = createBridgeRuntimeFeature({
      refs: {
        bridgeSection: document.getElementById("bridgeSection"),
        bridgeSummaryEl: document.getElementById("bridgeSummary"),
        bridgeListEl: document.getElementById("bridgeList"),
        bridgeDetailEl: detail,
        bridgeRefreshBtn: document.getElementById("bridgeRefresh"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "req-1",
      getBridgeRuntimeState: () => state,
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => `<time data-value="${value}">now</time>`,
      onOpenSourcePath,
      onOpenTask,
      showNotice: vi.fn(),
      t: (key, _params, fallback) => labels[key] ?? fallback ?? "",
    });

    expect(() => feature.refreshLocale()).not.toThrow();

    let shell = detail.querySelector(":scope > .memory-detail-shell");
    expect(shell).not.toBeNull();
    expect(shell.querySelectorAll(":scope > .memory-detail-card")).toHaveLength(2);
    const fieldCards = [...shell.querySelectorAll(".memory-detail-grid > .memory-detail-card")];
    expect(fieldCards).toHaveLength(6);
    expect(fieldCards.map((card) => card.querySelector(".memory-detail-label")?.textContent)).toEqual([
      labels["bridge.detailTarget"],
      "Status",
      "Close Reason",
      "Task ID",
      "CWD",
      "Buffered Output",
    ]);
    expect(fieldCards.map((card) => card.querySelector(".memory-detail-text")?.textContent)).toEqual([
      `${session.targetId}.${session.action}`,
      labels["bridge.statusActive"],
      labels["bridge.closeReasonManual"],
      session.taskId,
      session.cwd,
      "0",
    ]);
    expect(shell.querySelector(".bridge-command-preview")?.textContent).toBe(session.commandPreview);
    expect(shell.querySelector(".tool-settings-policy-note")?.textContent).toBe(session.firstTurnHint);
    expect(shell.querySelector(".bridge-live-output")?.textContent).toContain(peek.transcriptTail[0].content.trimEnd());
    expect(shell.querySelector(".bridge-live-output")?.textContent).toContain(peek.liveOutput.trimEnd());
    expect(shell.querySelector("img, svg, script, iframe, style, b, time, [onerror], [onload], [onclick]")).toBeNull();

    const taskButton = shell.querySelector("[data-bridge-open-task]");
    const sourceButtons = [...shell.querySelectorAll("[data-open-source]")];
    const refreshButton = shell.querySelector("[data-bridge-refresh-session]");
    expect(taskButton?.getAttribute("data-bridge-open-task")).toBe(session.taskId);
    expect(sourceButtons.map((button) => button.getAttribute("data-open-source"))).toEqual([
      session.transcriptPath,
      session.artifactPath,
    ]);
    expect(refreshButton?.getAttribute("data-bridge-refresh-session")).toBe(session.sessionId);

    taskButton.click();
    sourceButtons.forEach((button) => button.click());
    refreshButton.click();
    await flushPromises();

    expect(onOpenTask).toHaveBeenCalledWith(session.taskId);
    expect(onOpenSourcePath).toHaveBeenNthCalledWith(1, session.transcriptPath);
    expect(onOpenSourcePath).toHaveBeenNthCalledWith(2, session.artifactPath);
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "bridge.session.peek",
      params: expect.objectContaining({ sessionId: session.sessionId }),
    }));
    shell = detail.querySelector(":scope > .memory-detail-shell");
    expect(shell?.querySelectorAll(":scope > .memory-detail-card")).toHaveLength(2);
    feature.dispose();
  });
});
