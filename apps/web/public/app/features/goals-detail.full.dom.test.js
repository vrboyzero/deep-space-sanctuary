// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGoalsDetailFeature } from "./goals-detail.js";

let previousWebConfig;

beforeEach(() => {
  previousWebConfig = globalThis.BELLDANDY_WEB_CONFIG;
});

afterEach(() => {
  document.body.replaceChildren();
  if (previousWebConfig === undefined) {
    delete globalThis.BELLDANDY_WEB_CONFIG;
  } else {
    globalThis.BELLDANDY_WEB_CONFIG = previousWebConfig;
  }
});

describe("Goal Detail full shell DOM rendering", () => {
  it("renders full, archived, and compact replacements without using the HTML parser", () => {
    globalThis.BELLDANDY_WEB_CONFIG = { governanceDetailMode: "full" };
    document.body.innerHTML = '<div id="goalsDetail"></div>';
    const detailRoot = document.getElementById("goalsDetail");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(detailRoot, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Goal Detail full shell must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });

    const callbackOrder = [];
    const callback = (name) => vi.fn(() => callbackOrder.push(name));
    const onBindDetailActions = callback("bind");
    const onLoadGoalCanvasData = callback("canvas");
    const onLoadGoalTrackingData = callback("tracking");
    const onLoadGoalCapabilityData = callback("capability");
    const onLoadGoalProgressData = callback("progress");
    const onLoadGoalHandoffData = callback("handoff");
    const onLoadGoalReviewGovernanceData = callback("governance");
    const feature = createGoalsDetailFeature({
      refs: { goalsDetailEl: detailRoot },
      getActiveConversationId: () => "conversation:other",
      isConversationForGoal: () => false,
      escapeHtml: (value) => String(value ?? ""),
      formatGoalStatus: (value) => `<b>${value}</b>`,
      formatDateTime: (value) => `<time>${value ?? "-"}</time>`,
      formatGoalPathSource: (value) => `<svg>${value ?? "-"}</svg>`,
      goalDocFilePath: (goal, fileName) => `doc:${goal.id}:${fileName}`,
      goalRuntimeFilePath: (goal, fileName) => `runtime:${goal.id}:${fileName}`,
      goalBaseConversationId: (goalId) => `goal:${goalId}`,
      onBindDetailActions,
      onLoadGoalCanvasData,
      onLoadGoalTrackingData,
      onLoadGoalCapabilityData,
      onLoadGoalProgressData,
      onLoadGoalHandoffData,
      onLoadGoalReviewGovernanceData,
      t: (_key, _params, fallback) => fallback ?? "",
    });
    const goal = {
      id: 'goal:"<&',
      title: '<img src=x onerror="alert(1)">Goal title',
      objective: "<script>alert(2)</script>Objective",
      status: "executing",
      currentPhase: "<style>Phase</style>",
      activeNodeId: "<iframe>active-node</iframe>",
      lastNodeId: "<svg onload=alert(3)>last-node</svg>",
      lastRunId: '<b data-x="1">run-id</b>',
      activeConversationId: "<script>conversation</script>",
      pathSource: "<img src=x>path-source",
      updatedAt: "updated",
      createdAt: "created",
      lastActiveAt: "last-active",
      pausedAt: "paused",
      archivedAt: "archived",
      archiveReason: "<style>archive reason</style>",
      northstarPath: "path:<northstar>",
      tasksPath: "path:<tasks>",
      progressPath: "path:<progress>",
      handoffPath: "path:<handoff>",
      goalRoot: "root:<goal>",
      docRoot: "root:<doc>",
      runtimeRoot: "root:<runtime>",
    };

    expect(() => feature.renderGoalDetail(goal)).not.toThrow();
    const shell = detailRoot.querySelector(":scope > .memory-detail-shell");
    expect(shell).not.toBeNull();
    expect(shell.querySelector(".memory-detail-header .memory-detail-title")?.textContent).toBe(goal.title);
    expect(shell.querySelector(".memory-detail-header .memory-list-item-snippet")?.textContent).toBe(goal.objective);
    expect([...shell.querySelectorAll(".memory-detail-header .memory-detail-badges > .memory-badge")].map((item) => item.textContent)).toEqual([
      `<b>${goal.status}</b>`,
      goal.currentPhase,
    ]);

    const runtimeSummary = shell.querySelector(".goal-summary-card");
    expect([...runtimeSummary.querySelectorAll(".goal-summary-grid .goal-summary-value")].map((item) => item.textContent)).toEqual([
      `<b>${goal.status}</b>`,
      goal.activeNodeId,
      goal.lastNodeId,
      goal.lastRunId,
    ]);
    expect(runtimeSummary.querySelector(".memory-detail-pre")?.textContent).toBe(goal.activeConversationId);
    expect(runtimeSummary.querySelector(".goal-summary-header .memory-badge")?.textContent).toBe("resumable");

    const recovery = shell.querySelector(".goal-recovery-card");
    expect(recovery.querySelector(".goal-summary-title")?.textContent).toBe("Resume Current Node");
    expect(recovery.querySelector(".goal-summary-text")?.textContent).toContain(goal.activeNodeId);
    const recoveryButtons = [...recovery.querySelectorAll(".goal-detail-actions > button")];
    expect(recoveryButtons).toHaveLength(2);
    expect(recoveryButtons[0].getAttribute("data-goal-resume-last-node")).toBe(goal.id);
    expect(recoveryButtons[0].getAttribute("data-goal-last-node-id")).toBe(goal.activeNodeId);
    expect(recoveryButtons[1].getAttribute("data-goal-resume-detail")).toBe(goal.id);

    const topLevelGrids = [...shell.querySelectorAll(":scope > .memory-detail-grid")];
    expect(topLevelGrids[0].querySelectorAll(":scope > .memory-detail-card")).toHaveLength(11);
    const runButton = shell.querySelector(`[data-open-task-id]`);
    expect(runButton?.getAttribute("data-open-task-id")).toBe(goal.lastRunId);
    expect(runButton?.textContent).toBe(goal.lastRunId);
    const pathButtons = [...shell.querySelectorAll(".goal-path-list > [data-open-source]")];
    expect(pathButtons.map((button) => button.getAttribute("data-open-source"))).toEqual([
      `doc:${goal.id}:00-goal.md`,
      goal.northstarPath,
      goal.tasksPath,
      `runtime:${goal.id}:capability-plans.json`,
      `runtime:${goal.id}:checkpoints.json`,
      goal.progressPath,
      goal.handoffPath,
      `runtime:${goal.id}:state.json`,
      `runtime:${goal.id}:runtime.json`,
    ]);
    expect([...shell.querySelectorAll(".memory-detail-pre")].map((item) => item.textContent)).toEqual(expect.arrayContaining([
      goal.activeConversationId,
      goal.goalRoot,
      goal.docRoot,
      goal.runtimeRoot,
    ]));

    const nestedPanels = [
      ["goalHandoffPanel", "Loading handoff.md ..."],
      ["goalGovernancePanel", "Summarizing review governance / approval workflow ..."],
      ["goalCanvasPanel", "Loading board-ref.json ..."],
      ["goalTrackingPanel", "Loading tasks.json / checkpoints.json ..."],
      ["goalCapabilityPanel", "Loading capability-plans.json ..."],
      ["goalProgressPanel", "Loading progress.md ..."],
    ];
    for (const [id, loadingText] of nestedPanels) {
      expect(shell.querySelector(`#${id}`)?.textContent).toBe(loadingText);
    }
    expect(callbackOrder).toEqual(["bind", "canvas", "tracking", "capability", "progress", "handoff", "governance"]);
    expect(onBindDetailActions).toHaveBeenCalledWith(goal);
    expect(detailRoot.querySelector("img, svg, script, style, iframe, b, time, [onerror], [onload]")).toBeNull();

    feature.renderGoalDetail({
      ...goal,
      id: "goal-archived",
      title: "Archived replacement",
      status: "archived",
      currentPhase: "done",
      activeNodeId: "",
      lastNodeId: "",
      lastRunId: "",
    });
    const archivedShell = detailRoot.querySelector(":scope > .memory-detail-shell");
    expect(archivedShell.textContent).not.toContain(goal.title);
    expect([...archivedShell.querySelectorAll(".memory-detail-header .memory-badge")].map((item) => item.textContent)).toContain("archived");
    const archivedActions = archivedShell.querySelector(":scope > .goal-detail-actions");
    expect(archivedActions.querySelectorAll("button")).toHaveLength(2);
    expect(archivedActions.querySelector("[data-goal-delete-detail]")?.getAttribute("data-goal-delete-detail")).toBe("goal-archived");
    expect(archivedActions.querySelector("[data-goal-pause-detail], [data-goal-archive-detail]")).toBeNull();

    globalThis.BELLDANDY_WEB_CONFIG = { governanceDetailMode: "compact" };
    feature.renderGoalDetail({ ...goal, id: "goal-compact", title: "Compact replacement" });
    const compactShell = detailRoot.querySelector(":scope > .memory-detail-shell");
    expect(compactShell.textContent).not.toContain("Archived replacement");
    expect(compactShell.querySelector("#goalGovernancePanel")).not.toBeNull();
    expect(compactShell.querySelector("#goalTrackingPanel")).not.toBeNull();
    expect(compactShell.querySelector("#goalHandoffPanel, #goalCanvasPanel, #goalCapabilityPanel, #goalProgressPanel")).toBeNull();
    expect(compactShell.querySelector(".goal-path-list")).toBeNull();
  });
});
