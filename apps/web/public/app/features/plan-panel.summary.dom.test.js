// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlanPanelFeature } from "./plan-panel.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Plan Panel summary DOM rendering", () => {
  it("renders accessible plan text and clear replacement without using the HTML parser", () => {
    document.body.innerHTML = `
      <div id="sessionPlanPanel" class="hidden">
        <div id="sessionPlanSummary"></div>
      </div>
      <div id="sessionPlanModal" class="hidden">
        <span id="sessionPlanModalTitle"></span>
        <div id="sessionPlanModalMeta"></div>
        <div id="sessionPlanModalContent"></div>
        <button id="sessionPlanModalClose">关闭</button>
      </div>
    `;
    const panel = document.getElementById("sessionPlanPanel");
    const summary = document.getElementById("sessionPlanSummary");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(summary, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Plan Panel summary must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const planTitle = '<img src=x onerror="alert(1)">Plan title';
    const currentStepTitle = "<script>alert(2)</script>Current step";
    const nextAction = '<svg onload="alert(3)">Next action</svg>';
    const labels = {
      "panel.sessionPlanStatusBlocked": "<style>bad</style>Blocked",
      "panel.sessionPlanModeManual": "<iframe src=javascript:alert(4)>Manual</iframe>",
      "panel.sessionPlanProgress": "<b>Steps 1/2</b>",
      "panel.sessionPlanStepCurrent": "<script>Current</script>",
      "panel.sessionPlanRevision": "<svg>r3</svg>",
      "panel.sessionPlanUpdatedByUser": "<img src=x>User",
      "panel.sessionPlanUpdatedBy": "<style>Updated by User</style>",
      "panel.sessionPlanUpdatedAt": "<iframe>Updated now</iframe>",
      "panel.sessionPlanCurrentStepLabel": "<b>Current Step</b>",
      "panel.sessionPlanNextActionLabel": "<script>Next Action</script>",
      "panel.sessionPlanOpenFull": '<img src=x onerror="alert(5)">Open full plan',
    };
    const feature = createPlanPanelFeature({
      refs: {
        sessionPlanPanelEl: panel,
        sessionPlanSummaryEl: summary,
        sessionPlanModalEl: document.getElementById("sessionPlanModal"),
        sessionPlanModalTitleEl: document.getElementById("sessionPlanModalTitle"),
        sessionPlanModalMetaEl: document.getElementById("sessionPlanModalMeta"),
        sessionPlanModalContentEl: document.getElementById("sessionPlanModalContent"),
        sessionPlanModalCloseBtn: document.getElementById("sessionPlanModalClose"),
      },
      isConnected: () => true,
      getActiveConversationId: () => "conversation:plan",
      onOpenPlanAction: vi.fn(async () => {}),
      onLoadWorkflowStatus: vi.fn(async () => null),
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: () => '<time datetime="2026-07-20">now</time>',
      t: (key, _params, fallback) => labels[key] ?? fallback ?? "",
    });

    expect(() => feature.setPlanState({
      title: planTitle,
      status: "blocked",
      mode: "manual",
      revision: 3,
      updatedAt: 1,
      updatedBy: "user",
      currentStepId: "step-b",
      nextAction,
      steps: [
        { id: "step-a", title: "done", status: "completed" },
        { id: "step-b", title: currentStepTitle, status: "in_progress" },
      ],
    }, {
      conversationId: "conversation:plan",
      source: "event",
    })).not.toThrow();

    expect(panel.classList.contains("hidden")).toBe(false);
    const card = summary.querySelector(":scope > .session-plan-card");
    expect(card?.getAttribute("role")).toBe("button");
    expect(card?.getAttribute("tabindex")).toBe("0");
    expect(card?.title).toBe(labels["panel.sessionPlanOpenFull"]);
    expect(card?.getAttribute("aria-label")).toBe(labels["panel.sessionPlanOpenFull"]);
    expect(card?.querySelector(".session-plan-title")?.textContent).toBe(planTitle);

    const badges = [...card.querySelectorAll(".session-plan-badges > .memory-badge")];
    expect(badges.map((badge) => badge.textContent)).toEqual([
      labels["panel.sessionPlanStatusBlocked"],
      labels["panel.sessionPlanModeManual"],
      labels["panel.sessionPlanProgress"],
      labels["panel.sessionPlanStepCurrent"],
    ]);
    expect(badges[0].classList.contains("memory-badge-shared")).toBe(true);
    expect(badges[3].classList.contains("memory-badge-private")).toBe(true);
    expect([...card.querySelectorAll(".session-plan-meta > span")].map((item) => item.textContent)).toEqual([
      labels["panel.sessionPlanRevision"],
      labels["panel.sessionPlanUpdatedBy"],
      labels["panel.sessionPlanUpdatedAt"],
    ]);
    expect(card.querySelector(".session-plan-summary-text")?.textContent).toBe(
      `${labels["panel.sessionPlanCurrentStepLabel"]}: ${currentStepTitle} · ${labels["panel.sessionPlanNextActionLabel"]}: ${nextAction}`,
    );
    expect(summary.querySelector("img, svg, script, style, iframe, b, time, [onerror], [onload]")).toBeNull();

    feature.clear();
    expect(panel.classList.contains("hidden")).toBe(true);
    expect(summary.children).toHaveLength(0);
    feature.dispose();
  });
});
