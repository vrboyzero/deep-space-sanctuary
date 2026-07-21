// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createGoalsReadonlyPanelsFeature } from "./goals-readonly-panels.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Goal Progress full timeline DOM rendering", () => {
  it("renders the latest timeline entries as text without using the HTML parser", () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalProgressPanel"></div></div>';
    const panel = document.getElementById("goalProgressPanel");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(panel, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Goal Progress panel must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const feature = createGoalsReadonlyPanelsFeature({
      refs: { goalsDetailEl: document.getElementById("goalsDetail") },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => `<time>${value ?? "-"}</time>`,
      normalizeGoalBoardId: (value) => String(value ?? ""),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });
    const malicious = {
      title: '<img src=x onerror="alert(1)">timeline title',
      event: "checkpoint_approved",
      nodeId: "<svg>node</svg>",
      checkpointId: "<script>checkpoint</script>",
      summary: "<style>summary</style>timeline summary",
      note: "<iframe>note</iframe>timeline note",
    };
    const entries = Array.from({ length: 19 }, (_, index) => ({
      title: index === 18 ? malicious.title : `timeline-${index}`,
      event: index === 18 ? malicious.event : index % 2 ? "node_started" : "timeline",
      at: `time-${index}`,
      nodeId: index === 18 ? malicious.nodeId : `node-${index}`,
      status: index === 18 ? "approved" : index % 2 ? "running" : "completed",
      checkpointId: index === 18 ? malicious.checkpointId : `checkpoint-${index}`,
      summary: index === 18 ? malicious.summary : `summary-${index}`,
      note: index === 18 ? malicious.note : `note-${index}`,
    }));

    expect(() => feature.renderGoalProgressPanel(entries)).not.toThrow();
    expect(panel.querySelectorAll(":scope > .goal-progress-timeline > .goal-progress-item")).toHaveLength(18);
    const firstEntry = panel.querySelector(".goal-progress-item");
    expect(firstEntry?.querySelector(".goal-tracking-item-title")?.textContent).toBe(malicious.title);
    expect(firstEntry?.textContent).toContain("Checkpoint 已批准");
    expect(firstEntry?.textContent).toContain(malicious.nodeId);
    expect(firstEntry?.textContent).toContain(malicious.checkpointId);
    expect(firstEntry?.textContent).toContain(malicious.summary);
    expect(firstEntry?.textContent).toContain(malicious.note);
    expect(firstEntry?.textContent).toContain("<time>time-18</time>");
    expect(panel.textContent).not.toContain("timeline-0");
    expect(panel.querySelector("img, svg, script, style, iframe, time, [onerror], [onload]")).toBeNull();

    feature.renderGoalProgressPanel([]);
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(panel.firstElementChild.textContent).toBe("progress.md 中还没有时间线记录。");
  });
});
