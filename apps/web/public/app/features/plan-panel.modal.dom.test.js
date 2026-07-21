// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlanPanelFeature } from "./plan-panel.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Plan Panel modal DOM rendering", () => {
  it("renders plan structure, actions, workflow state, and replacement without using the HTML parser", async () => {
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
    const summary = document.getElementById("sessionPlanSummary");
    const modal = document.getElementById("sessionPlanModal");
    const content = document.getElementById("sessionPlanModalContent");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(content, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Plan Panel modal must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });

    const planTitle = '<img src=x onerror="alert(1)">Plan title';
    const planSummary = "<script>alert(2)</script>Plan summary";
    const stepId = 'step:<svg onload="alert(3)">';
    const stepTitle = "<style>bad</style>Current step";
    const stepSummary = '<iframe src="javascript:alert(4)">Step summary</iframe>';
    const stepBlocker = "<b>Blocked body</b>";
    const nextAction = "<script>alert(5)</script>Next action";
    const goalLabel = '<img src=x onerror="alert(6)">Goal ref';
    const workflowLabel = "<svg onload=alert(7)>Workflow ref</svg>";
    const staticRefLabel = "<iframe>Static ref</iframe>";
    const workflowName = "<style>Workflow name</style>";
    const onOpenPlanAction = vi.fn(async () => {});
    const onLoadWorkflowStatus = vi.fn(async () => ({
      status: "done",
      workflowName,
      journalId: "wf:<&",
    }));
    const labels = {
      "panel.sessionPlanStatusBlocked": "<b>Blocked</b>",
      "panel.sessionPlanModeManual": "<i>Manual</i>",
      "panel.sessionPlanRevision": "<svg>r9</svg>",
      "panel.sessionPlanCurrentStepLabel": "<script>Current Step</script>",
      "panel.sessionPlanNextActionLabel": "<style>Next Action</style>",
      "panel.sessionPlanBlockerLabel": "<iframe>Blocker</iframe>",
      "panel.sessionPlanStepListLabel": "<img src=x>Steps",
      "panel.sessionPlanProgress": "<b>Steps 1/2</b>",
      "panel.sessionPlanStepStatusBlocked": "<script>Step blocked</script>",
      "panel.sessionPlanStepStatusCompleted": "<style>Step completed</style>",
      "panel.sessionPlanStepCurrent": "<iframe>Current</iframe>",
      "panel.sessionPlanEmptySteps": "<svg>No steps</svg>",
      "panel.sessionPlanWorkflowStatusCompleted": "<b>Completed</b>",
      "panel.sessionPlanClose": '<img src=x onerror="alert(8)">Close',
    };
    const feature = createPlanPanelFeature({
      refs: {
        sessionPlanPanelEl: document.getElementById("sessionPlanPanel"),
        sessionPlanSummaryEl: summary,
        sessionPlanModalEl: modal,
        sessionPlanModalTitleEl: document.getElementById("sessionPlanModalTitle"),
        sessionPlanModalMetaEl: document.getElementById("sessionPlanModalMeta"),
        sessionPlanModalContentEl: content,
        sessionPlanModalCloseBtn: document.getElementById("sessionPlanModalClose"),
      },
      isConnected: () => true,
      getActiveConversationId: () => "conversation:plan",
      onOpenPlanAction,
      onLoadWorkflowStatus,
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: () => "<time>now</time>",
      t: (key, _params, fallback) => labels[key] ?? fallback ?? "",
    });

    feature.setPlanState({
      title: planTitle,
      summary: planSummary,
      status: "blocked",
      mode: "manual",
      revision: 9,
      updatedAt: 1,
      updatedBy: "system",
      currentStepId: stepId,
      nextAction,
      blocker: "",
      steps: [
        {
          id: stepId,
          title: stepTitle,
          summary: stepSummary,
          blocker: stepBlocker,
          status: "blocked",
          updatedAt: 1,
          refs: [
            { kind: "goal", goalId: 'goal:"<&', nodeId: "node:<&", label: goalLabel },
            { kind: "workflow", journalId: "wf:<&", workflowName, label: workflowLabel },
            { kind: "goal", label: staticRefLabel },
          ],
        },
        { title: "<b>Untargeted step</b>", status: "completed", updatedAt: 1 },
      ],
    }, {
      conversationId: "conversation:plan",
      source: "event:<svg>",
    });

    expect(() => summary.querySelector(".session-plan-card").click()).not.toThrow();
    expect(modal.classList.contains("hidden")).toBe(false);
    expect(content.querySelector(":scope > .session-plan-modal-summary .session-plan-modal-plan-title")?.textContent).toBe(planTitle);
    expect(content.querySelector(".session-plan-modal-plan-summary")?.textContent).toBe(planSummary);
    expect([...content.querySelectorAll(".session-plan-modal-summary .memory-badge")].map((item) => item.textContent)).toEqual([
      labels["panel.sessionPlanStatusBlocked"],
      labels["panel.sessionPlanModeManual"],
      labels["panel.sessionPlanRevision"],
    ]);
    expect(content.querySelectorAll(".session-plan-modal-grid > .session-plan-modal-card")).toHaveLength(3);
    expect([...content.querySelectorAll(".session-plan-modal-grid .session-plan-modal-card-value")].map((item) => item.textContent)).toEqual([
      stepTitle,
      nextAction,
      stepBlocker,
    ]);
    expect(content.querySelector(".session-plan-modal-section-title")?.textContent).toBe(labels["panel.sessionPlanStepListLabel"]);
    expect(content.querySelector(".session-plan-modal-section-head .memory-badge")?.textContent).toBe(labels["panel.sessionPlanProgress"]);

    const currentStep = content.querySelector(".session-plan-step-item");
    expect(currentStep?.getAttribute("data-plan-step-id")).toBe(stepId);
    expect(currentStep?.classList.contains("is-current")).toBe(true);
    expect(currentStep?.classList.contains("is-blocked")).toBe(true);
    expect(currentStep?.classList.contains("is-continuation-focus")).toBe(true);
    expect(currentStep?.querySelector(".session-plan-step-summary")?.textContent).toBe(stepSummary);
    expect(currentStep?.querySelector(".session-plan-step-blocker")?.textContent).toBe(
      `${labels["panel.sessionPlanBlockerLabel"]}: ${stepBlocker}`,
    );
    expect([...currentStep.querySelectorAll(".session-plan-step-title-row > .memory-badge")].map((item) => item.textContent)).toEqual([
      labels["panel.sessionPlanStepStatusBlocked"],
      labels["panel.sessionPlanStepCurrent"],
    ]);

    const stepButton = currentStep.querySelector(".session-plan-step-action");
    expect(JSON.parse(stepButton.getAttribute("data-plan-action"))).toEqual({ kind: "step", stepId });
    expect(stepButton.title).toBe(stepTitle);
    expect(stepButton.getAttribute("aria-label")).toBe(stepTitle);
    const untargetedStepTitle = content.querySelectorAll(".session-plan-step-item")[1]
      .querySelector(".session-plan-step-title");
    expect(untargetedStepTitle.tagName).toBe("SPAN");

    const refEntries = [...currentStep.querySelectorAll(".session-plan-ref-entry")];
    expect(refEntries).toHaveLength(3);
    const goalButton = refEntries[0].querySelector("button");
    expect(goalButton.textContent).toBe(`Goal · ${goalLabel}`);
    expect(JSON.parse(goalButton.getAttribute("data-plan-action"))).toEqual({
      kind: "continuation",
      action: { kind: "node", goalId: 'goal:"<&', nodeId: "node:<&" },
      refKind: "goal",
      refKey: 'goal:goal:"<&:node:<&',
    });
    goalButton.click();
    await Promise.resolve();
    expect(onOpenPlanAction).toHaveBeenCalledWith({ kind: "node", goalId: 'goal:"<&', nodeId: "node:<&" });

    const workflowButton = [...content.querySelectorAll(".session-plan-ref-badge")]
      .find((item) => item.textContent === `Workflow · ${workflowLabel}`);
    workflowButton.click();
    await vi.waitFor(() => {
      expect(onLoadWorkflowStatus).toHaveBeenCalledWith({ journalId: "wf:<&" });
      expect(content.querySelector(".session-plan-ref-status")?.textContent).toContain(workflowName);
    });
    const renderedWorkflow = [...content.querySelectorAll(".session-plan-ref-badge")]
      .find((item) => item.textContent === `Workflow · ${workflowLabel}`);
    expect(renderedWorkflow.classList.contains("is-continuation-focus")).toBe(true);
    expect(renderedWorkflow.classList.contains("is-workflow-completed")).toBe(true);
    expect(refEntries[2].querySelector("span.session-plan-ref-badge")?.textContent).toBe(`Goal · ${staticRefLabel}`);
    expect(content.querySelector("img, svg, script, style, iframe, b, i, time, [onerror], [onload]")).toBeNull();

    feature.setPlanState({
      title: "Replacement plan",
      status: "active",
      mode: "agent",
      revision: 10,
      steps: [],
    }, { conversationId: "conversation:plan", source: "event" });
    expect(content.querySelectorAll(":scope > *")).toHaveLength(3);
    expect(content.querySelector(".session-plan-empty")?.textContent).toBe(labels["panel.sessionPlanEmptySteps"]);
    expect(content.textContent).not.toContain(planTitle);

    feature.clear();
    expect(modal.classList.contains("hidden")).toBe(true);
    expect(content.children).toHaveLength(0);
    feature.dispose();
  });
});
