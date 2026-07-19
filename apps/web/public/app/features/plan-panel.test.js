// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlanPanelFeature } from "./plan-panel.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function createHarness(activeConversationId = "conversation:plan", overrides = {}) {
  const openPlanAction = vi.fn(async () => {});
  const loadWorkflowStatus = overrides.loadWorkflowStatus || vi.fn(async () => ({
    status: "running",
    workflowName: "Plan Bridge Workflow",
    journalId: "wf_123",
  }));

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

  const feature = createPlanPanelFeature({
    refs: {
      sessionPlanPanelEl: document.getElementById("sessionPlanPanel"),
      sessionPlanSummaryEl: document.getElementById("sessionPlanSummary"),
      sessionPlanModalEl: document.getElementById("sessionPlanModal"),
      sessionPlanModalTitleEl: document.getElementById("sessionPlanModalTitle"),
      sessionPlanModalMetaEl: document.getElementById("sessionPlanModalMeta"),
      sessionPlanModalContentEl: document.getElementById("sessionPlanModalContent"),
      sessionPlanModalCloseBtn: document.getElementById("sessionPlanModalClose"),
    },
    isConnected: () => true,
    getActiveConversationId: () => activeConversationId,
    onOpenPlanAction: openPlanAction,
    onLoadWorkflowStatus: loadWorkflowStatus,
    escapeHtml,
    formatDateTime: () => "2026-06-27 11:30:00",
    t: (_key, _params, fallback) => fallback ?? "",
  });

  return {
    feature,
    openPlanAction,
    loadWorkflowStatus,
    refs: {
      sessionPlanPanelEl: document.getElementById("sessionPlanPanel"),
      sessionPlanSummaryEl: document.getElementById("sessionPlanSummary"),
      sessionPlanModalEl: document.getElementById("sessionPlanModal"),
      sessionPlanModalTitleEl: document.getElementById("sessionPlanModalTitle"),
      sessionPlanModalMetaEl: document.getElementById("sessionPlanModalMeta"),
      sessionPlanModalContentEl: document.getElementById("sessionPlanModalContent"),
    },
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("plan panel feature", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stays hidden when the current conversation has no plan", () => {
    const { refs } = createHarness();
    expect(refs.sessionPlanPanelEl.classList.contains("hidden")).toBe(true);
    expect(refs.sessionPlanSummaryEl.textContent).toBe("");
  });

  it("renders the current plan from conversation meta and opens a detailed modal", () => {
    const { feature, refs } = createHarness();

    feature.setPlanState({
      title: "统一 Plan Mode",
      status: "active",
      mode: "agent",
      revision: 3,
      updatedAt: 1,
      updatedBy: "agent",
      currentStepId: "step-b",
      nextAction: "把 planState 接到 WebChat 统一计划面板。",
      summary: "为复杂任务建立统一的计划真源与展示面板。",
      blocker: "",
      steps: [
        { id: "step-a", title: "接后端 planState", status: "completed", updatedAt: 1 },
        { id: "step-b", title: "实现 plan panel UI", status: "in_progress", updatedAt: 1 },
      ],
    }, {
      conversationId: "conversation:plan",
      source: "load",
    });

    expect(refs.sessionPlanPanelEl.classList.contains("hidden")).toBe(false);
    expect(refs.sessionPlanSummaryEl.textContent).toContain("统一 Plan Mode");
    expect(refs.sessionPlanSummaryEl.textContent).toContain("Active");
    expect(refs.sessionPlanSummaryEl.textContent).toContain("Current");
    expect(refs.sessionPlanSummaryEl.textContent).toContain("Current Step: 实现 plan panel UI");

    refs.sessionPlanSummaryEl.querySelector(".session-plan-card")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(refs.sessionPlanModalEl.classList.contains("hidden")).toBe(false);
    expect(refs.sessionPlanModalContentEl.textContent).toContain("实现 plan panel UI");
    expect(refs.sessionPlanModalContentEl.textContent).toContain("把 planState 接到 WebChat 统一计划面板。");
  });

  it("supports step focus and continuation ref actions inside the modal", async () => {
    const { feature, refs, openPlanAction } = createHarness();

    feature.setPlanState({
      title: "统一 Plan Mode",
      status: "active",
      mode: "agent",
      revision: 3,
      updatedAt: 1,
      updatedBy: "agent",
      currentStepId: "step-b",
      steps: [
        {
          id: "step-a",
          title: "接 goals bridge",
          status: "pending",
          updatedAt: 1,
          refs: [{ kind: "goal", goalId: "goal-1", nodeId: "node-2", label: "Goal Node" }],
        },
        {
          id: "step-b",
          title: "接 subtasks bridge",
          status: "in_progress",
          updatedAt: 1,
          refs: [{ kind: "subtask", taskId: "task-1", sessionId: "session-1", label: "Subtask Lane" }],
        },
      ],
    }, {
      conversationId: "conversation:plan",
      source: "load",
    });

    refs.sessionPlanSummaryEl.querySelector(".session-plan-card")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const stepActionBtn = refs.sessionPlanModalContentEl.querySelector('[data-plan-step-id="step-a"] .session-plan-step-action');
    stepActionBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(refs.sessionPlanModalContentEl.querySelector('[data-plan-step-id="step-a"]')?.classList.contains("is-continuation-focus")).toBe(true);

    const goalRefBtn = [...refs.sessionPlanModalContentEl.querySelectorAll(".session-plan-ref-badge")]
      .find((node) => node.textContent?.includes("Goal Node"));
    goalRefBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(openPlanAction).toHaveBeenCalledWith({
      kind: "node",
      goalId: "goal-1",
      nodeId: "node-2",
    });
  });

  it("loads workflow status and highlights the clicked workflow ref", async () => {
    const { feature, refs, loadWorkflowStatus } = createHarness();

    feature.setPlanState({
      title: "Workflow bridge",
      status: "active",
      mode: "agent",
      revision: 1,
      updatedAt: 1,
      updatedBy: "agent",
      steps: [
        {
          id: "step-workflow",
          title: "观察 workflow",
          status: "in_progress",
          updatedAt: 1,
          refs: [{ kind: "workflow", journalId: "wf_123", workflowName: "Plan Bridge Workflow", label: "Bridge WF" }],
        },
      ],
    }, {
      conversationId: "conversation:plan",
      source: "load",
    });

    refs.sessionPlanSummaryEl.querySelector(".session-plan-card")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const workflowRefBtn = refs.sessionPlanModalContentEl.querySelector(".session-plan-ref-badge");
    workflowRefBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(loadWorkflowStatus).toHaveBeenCalledWith({ journalId: "wf_123" });
    expect(refs.sessionPlanModalContentEl.textContent).toContain("Plan Bridge Workflow");
    expect(refs.sessionPlanModalContentEl.querySelector(".session-plan-ref-badge")?.classList.contains("is-continuation-focus")).toBe(true);
  });

  it("keeps a late workflow response from replacing the latest status", async () => {
    const firstResponse = createDeferred();
    const secondResponse = createDeferred();
    const loadWorkflowStatus = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    const { feature, refs } = createHarness("conversation:plan", { loadWorkflowStatus });

    feature.setPlanState({
      title: "Workflow replacement",
      status: "active",
      mode: "agent",
      revision: 1,
      updatedAt: 1,
      updatedBy: "agent",
      steps: [{
        id: "step-workflow",
        title: "观察 workflow",
        status: "in_progress",
        updatedAt: 1,
        refs: [{ kind: "workflow", journalId: "wf_123", workflowName: "Plan Bridge Workflow", label: "Bridge WF" }],
      }],
    }, { conversationId: "conversation:plan", source: "load" });
    refs.sessionPlanSummaryEl.querySelector(".session-plan-card")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    refs.sessionPlanModalContentEl.querySelector(".session-plan-ref-badge")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    refs.sessionPlanModalContentEl.querySelector(".session-plan-ref-badge")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(feature.getRuntimeSnapshot().pendingWorkflowStatusRequestCount).toBe(2);

    secondResponse.resolve({ status: "completed", workflowName: "Fresh Workflow", journalId: "wf_123" });
    await Promise.resolve();
    await Promise.resolve();
    expect(refs.sessionPlanModalContentEl.textContent).toContain("Fresh Workflow");

    firstResponse.resolve({ status: "failed", workflowName: "Late Workflow", journalId: "wf_123" });
    await Promise.resolve();
    await Promise.resolve();
    expect(refs.sessionPlanModalContentEl.textContent).toContain("Fresh Workflow");
    expect(refs.sessionPlanModalContentEl.textContent).not.toContain("Late Workflow");
    expect(feature.getRuntimeSnapshot().pendingWorkflowStatusRequestCount).toBe(0);
  });

  it("deactivates plan roots and reactivates without late workflow state", async () => {
    const response = createDeferred();
    const loadWorkflowStatus = vi.fn(() => response.promise);
    const { feature, refs } = createHarness("conversation:plan", { loadWorkflowStatus });
    feature.setPlanState({
      title: "Disposable workflow plan",
      status: "active",
      mode: "agent",
      revision: 1,
      updatedAt: 1,
      updatedBy: "agent",
      steps: [{
        id: "step-workflow",
        title: "观察 workflow",
        status: "in_progress",
        updatedAt: 1,
        refs: [{ kind: "workflow", journalId: "wf_123", workflowName: "Plan Bridge Workflow", label: "Bridge WF" }],
      }],
    }, { conversationId: "conversation:plan", source: "load" });
    const detachedSummary = refs.sessionPlanSummaryEl;
    detachedSummary.querySelector(".session-plan-card")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    refs.sessionPlanModalContentEl.querySelector(".session-plan-ref-badge")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(feature.deactivate()).toBe(true);
    detachedSummary.remove();
    detachedSummary.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 0,
      pendingWorkflowStatusRequestCount: 1,
      modalOpen: false,
      disposed: false,
    });

    response.resolve({ status: "completed", workflowName: "Late Workflow", journalId: "wf_123" });
    await Promise.resolve();
    await Promise.resolve();
    expect(refs.sessionPlanModalContentEl.textContent).toBe("");
    expect(feature.getRuntimeSnapshot().pendingWorkflowStatusRequestCount).toBe(0);

    expect(feature.activate()).toBe(true);
    feature.setPlanState({
      title: "Fresh active plan",
      status: "active",
      mode: "agent",
      revision: 2,
      updatedAt: 2,
      updatedBy: "agent",
      steps: [],
    }, { conversationId: "conversation:plan", source: "event" });
    feature.setFocusedStep("step-fresh");
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 5,
      pendingWorkflowStatusRequestCount: 0,
      disposed: false,
    });
  });

  it("invalidates pending workflow state when the plan is cleared", async () => {
    for (const clearMode of ["clear", "null-plan"]) {
      const response = createDeferred();
      const loadWorkflowStatus = vi.fn(() => response.promise);
      const { feature, refs } = createHarness("conversation:plan", { loadWorkflowStatus });
      const buildPlan = (title, revision) => ({
        title,
        status: "active",
        mode: "agent",
        revision,
        updatedAt: revision,
        updatedBy: "agent",
        steps: [{
          id: "step-workflow",
          title: "观察 workflow",
          status: "in_progress",
          updatedAt: revision,
          refs: [{ kind: "workflow", journalId: "wf_123", workflowName: "Plan Bridge Workflow", label: "Bridge WF" }],
        }],
      });

      feature.setPlanState(buildPlan("Old plan", 1), { conversationId: "conversation:plan", source: "load" });
      refs.sessionPlanSummaryEl.querySelector(".session-plan-card")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      refs.sessionPlanModalContentEl.querySelector(".session-plan-ref-badge")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(feature.getRuntimeSnapshot().pendingWorkflowStatusRequestCount).toBe(1);

      if (clearMode === "clear") {
        feature.clear();
      } else {
        feature.setPlanState(null, { conversationId: "conversation:plan", source: "event" });
      }
      response.resolve({ status: "failed", workflowName: "Late Workflow", journalId: "wf_123" });
      await Promise.resolve();
      await Promise.resolve();

      feature.setPlanState(buildPlan("Fresh plan", 2), { conversationId: "conversation:plan", source: "event" });
      refs.sessionPlanSummaryEl.querySelector(".session-plan-card")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(refs.sessionPlanModalContentEl.textContent).not.toContain("Late Workflow");
      expect(feature.getRuntimeSnapshot().pendingWorkflowStatusRequestCount).toBe(0);
      feature.dispose();
    }
  });

  it("ignores updates for inactive conversations and hides after clear", () => {
    const { feature, refs } = createHarness();

    feature.setPlanState({
      title: "Current plan",
      status: "active",
      mode: "agent",
      revision: 1,
      updatedAt: 1,
      updatedBy: "agent",
      steps: [],
    }, {
      conversationId: "conversation:plan",
      source: "load",
    });

    feature.handlePlanUpdated({
      conversationId: "conversation:other",
      source: "tool",
      planState: {
        title: "Other plan",
        status: "blocked",
        mode: "agent",
        revision: 2,
        updatedAt: 1,
        updatedBy: "system",
        steps: [],
      },
    });

    expect(refs.sessionPlanSummaryEl.textContent).toContain("Current plan");
    expect(refs.sessionPlanSummaryEl.textContent).not.toContain("Other plan");

    feature.handlePlanUpdated({
      conversationId: "conversation:plan",
      source: "tool",
      cleared: true,
      planState: null,
    });

    expect(refs.sessionPlanPanelEl.classList.contains("hidden")).toBe(true);
    expect(refs.sessionPlanSummaryEl.textContent).toBe("");
  });

  it("releases root listeners and retained plan content after dispose", () => {
    const { feature, refs } = createHarness();

    feature.setPlanState({
      title: "Disposable plan body",
      status: "active",
      mode: "agent",
      revision: 1,
      updatedAt: 1,
      updatedBy: "agent",
      currentStepId: "step-a",
      steps: [{ id: "step-a", title: "Retained step body", status: "in_progress", updatedAt: 1 }],
    }, {
      conversationId: "conversation:plan",
      source: "load",
    });
    refs.sessionPlanSummaryEl.querySelector(".session-plan-card")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 5,
      pendingWorkflowStatusRequestCount: 0,
      modalOpen: true,
      disposed: false,
    });
    expect(refs.sessionPlanModalContentEl.textContent).toContain("Retained step body");

    feature.dispose();
    feature.dispose();

    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      pendingWorkflowStatusRequestCount: 0,
      modalOpen: false,
      disposed: true,
    });
    expect(refs.sessionPlanPanelEl.classList.contains("hidden")).toBe(true);
    expect(refs.sessionPlanSummaryEl.textContent).toBe("");
    expect(refs.sessionPlanModalEl.classList.contains("hidden")).toBe(true);
    expect(refs.sessionPlanModalTitleEl.textContent).toBe("");
    expect(refs.sessionPlanModalMetaEl.textContent).toBe("");
    expect(refs.sessionPlanModalContentEl.textContent).toBe("");

    feature.setPlanState({ title: "Late plan body", steps: [] }, {
      conversationId: "conversation:plan",
      source: "event",
    });
    feature.handlePlanUpdated({
      conversationId: "conversation:plan",
      planState: { title: "Late event body", steps: [] },
    });
    feature.refreshLocale();
    feature.setFocusedStep("late-step");
    feature.setFocusedRef("late-ref");
    expect(refs.sessionPlanSummaryEl.textContent).toBe("");
    expect(refs.sessionPlanModalContentEl.textContent).toBe("");
  });
});
