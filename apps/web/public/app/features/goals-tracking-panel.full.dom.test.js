// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGoalsTrackingPanelFeature } from "./goals-tracking-panel.js";

let previousWebConfig;

beforeEach(() => {
  previousWebConfig = globalThis.BELLDANDY_WEB_CONFIG;
  globalThis.BELLDANDY_WEB_CONFIG = { governanceDetailMode: "full" };
});

afterEach(() => {
  document.body.replaceChildren();
  if (previousWebConfig === undefined) {
    delete globalThis.BELLDANDY_WEB_CONFIG;
  } else {
    globalThis.BELLDANDY_WEB_CONFIG = previousWebConfig;
  }
});

describe("Goal Tracking full panel DOM rendering", () => {
  it("renders focus, bridge, checkpoint actions, SLA, history, and replacement without using the HTML parser", () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalTrackingPanel"></div></div>';
    const panel = document.getElementById("goalTrackingPanel");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(panel, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Goal Tracking panel must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const malicious = {
      headline: '<img src=x onerror="alert(1)">freshness',
      nodeTitle: "<script>alert(2)</script>Focused node",
      nodeSummary: "<style>bad</style>Node summary",
      nodeOwner: "<iframe>node-owner</iframe>",
      checkpointTitle: '<svg onload="alert(3)">Checkpoint</svg>',
      checkpointSummary: "<b>Checkpoint summary</b>",
      reviewer: "<img src=x>reviewer",
      historyNote: "<script>alert(4)</script>history note",
      bridgeLine: "<style>bridge line</style>Bridge summary",
    };
    const onSlaBadge = vi.fn(() => '<span class="unsafe">SLA unsafe</span>');
    const feature = createGoalsTrackingPanelFeature({
      refs: { goalsDetailEl: document.getElementById("goalsDetail") },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => `<time>${value ?? "-"}</time>`,
      getGoalCheckpointSlaBadge: onSlaBadge,
      summarizeSourcePath: (value) => `<path>${value}</path>`,
      t: (_key, _params, fallback) => fallback ?? "",
    });
    const goal = { id: 'goal:"<&' };
    const focusNode = {
      id: 'node:<&',
      title: malicious.nodeTitle,
      summary: malicious.nodeSummary,
      status: "completed",
      phase: "<b>verify</b>",
      owner: malicious.nodeOwner,
      lastRunId: 'run:<&',
      artifacts: ["artifact:<&", "second:<&", "third-truncated"],
      bridgeSessionView: {
        summaryLine: malicious.bridgeLine,
        blockReason: "<img src=x>bridge block",
        runtimeState: "running",
        closeReason: "completed",
        artifactPath: "bridge-artifact:<&",
        transcriptPath: "bridge-transcript:<&",
      },
      bridgeSubtaskView: { summaryLine: "<b>subtask summary</b>" },
    };
    const nodes = [focusNode, ...Array.from({ length: 6 }, (_, index) => ({
      id: `node-${index + 2}`,
      title: `node-${index + 2}`,
      status: index % 2 ? "running" : "blocked",
    }))];
    const history = ["one", "two", "three", "four", "five"].map((note, index) => ({
      action: index === 0 ? "approve" : "request",
      at: `history-${index}`,
      actor: `<b>actor-${index}</b>`,
      note: index === 0 ? malicious.historyNote : note,
    }));
    const checkpoint = {
      id: "checkpoint:<&",
      nodeId: focusNode.id,
      title: malicious.checkpointTitle,
      summary: malicious.checkpointSummary,
      status: "waiting_user",
      reviewer: malicious.reviewer,
      reviewerRole: "<svg>verifier</svg>",
      requestedBy: "<i>agent</i>",
      runId: "run:checkpoint:<&",
      slaAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "checkpoint-updated",
      history,
    };
    const featurePayload = {
      nodes,
      focusNodeId: focusNode.id,
      checkpoints: [checkpoint, ...Array.from({ length: 6 }, (_, index) => ({
        id: `checkpoint-${index + 2}`,
        nodeId: `node-${index + 2}`,
        title: `checkpoint-${index + 2}`,
        status: "approved",
        updatedAt: `2026-01-0${index + 1}`,
      }))],
      capabilityPlans: [{
        nodeId: focusNode.id,
        updatedAt: "2026-07-20T00:00:00.000Z",
        riskLevel: "high",
        checkpoint: {
          required: true,
          suggestedReviewer: "<img src=x>reviewer",
          suggestedReviewerRole: "verifier",
          suggestedTitle: "<script>checkpoint title</script>",
          suggestedNote: "<style>checkpoint note</style>",
        },
      }],
      memoryFreshness: { summary: { available: true, headline: malicious.headline } },
    };

    expect(() => feature.renderGoalTrackingPanel(goal, featurePayload)).not.toThrow();
    expect(panel.querySelector(".tool-settings-policy-note")?.textContent).toContain(malicious.headline);
    expect(panel.querySelectorAll(".goal-tracking-stats > .goal-summary-item")).toHaveLength(8);
    expect(panel.querySelectorAll(".goal-tracking-columns > .goal-tracking-column")).toHaveLength(2);
    expect(panel.querySelectorAll(".goal-tracking-columns > .goal-tracking-column:first-child .goal-tracking-item")).toHaveLength(6);
    const nodeItem = panel.querySelector(".goal-tracking-columns > .goal-tracking-column:first-child .goal-tracking-item");
    expect(nodeItem?.querySelector(".goal-tracking-item-title")?.textContent).toBe(malicious.nodeTitle);
    expect(nodeItem?.querySelector(".memory-list-item-snippet")?.textContent).toBe(malicious.nodeSummary);
    expect(nodeItem?.querySelectorAll(".goal-checkpoint-actions [data-open-task-id]")[0]?.getAttribute("data-open-task-id")).toBe(focusNode.lastRunId);
    expect([...nodeItem.querySelectorAll(".goal-checkpoint-actions [data-open-source]")].map((item) => item.getAttribute("data-open-source"))).toEqual([
      "artifact:<&",
      "second:<&",
      "bridge-artifact:<&",
      "bridge-transcript:<&",
    ]);
    expect(nodeItem.textContent).toContain(malicious.bridgeLine);
    expect(nodeItem.querySelectorAll(".goal-checkpoint-meta .memory-badge").length).toBeGreaterThan(0);

    const checkpointItem = panel.querySelector(".goal-tracking-columns > .goal-tracking-column:nth-child(2) .goal-tracking-item");
    expect(checkpointItem?.querySelector(".goal-tracking-item-title")?.textContent).toBe(malicious.checkpointTitle);
    expect(checkpointItem?.querySelector(".memory-list-item-snippet")?.textContent).toBe(malicious.checkpointSummary);
    expect(checkpointItem?.querySelector(".goal-checkpoint-meta")?.textContent).toContain(malicious.reviewer);
    expect(checkpointItem?.querySelector(".goal-checkpoint-meta")?.textContent).toContain("SLA 已超时");
    expect(checkpointItem?.querySelector(".goal-checkpoint-meta")?.textContent).toContain("<time>");
    expect(checkpointItem?.querySelectorAll(".tool-settings-policy-note > div")).toHaveLength(2);
    expect(checkpointItem?.querySelectorAll(".goal-checkpoint-actions [data-goal-checkpoint-action]")).toHaveLength(3);
    expect(checkpointItem?.querySelector('[data-goal-checkpoint-action="approve"]')?.getAttribute("data-goal-checkpoint-goal-id")).toBe(goal.id);
    expect(checkpointItem?.querySelectorAll(".goal-checkpoint-history-item")).toHaveLength(4);
    expect(checkpointItem?.textContent).not.toContain(malicious.historyNote);
    expect(panel.querySelector(".unsafe")).toBeNull();
    expect(panel.querySelector("img, svg, script, style, iframe, b, i, time, path, [onerror], [onload]")).toBeNull();

    feature.renderGoalTrackingPanel(goal, { nodes: [], checkpoints: [], focusNodeId: "node:none" });
    expect(panel.querySelectorAll(":scope > *")).toHaveLength(2);
    expect(panel.textContent).toContain("tasks.json 中还没有节点。");
    expect(panel.textContent).toContain("当前 node 还没有关联 checkpoint。");
    feature.renderGoalTrackingPanelError('<img src=x>tracking error');
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.textContent).toBe('<img src=x>tracking error');
  });
});
