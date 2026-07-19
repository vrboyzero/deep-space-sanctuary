import { describe, expect, it, vi } from "vitest";

import { createGoalsCapabilityPanelControlsFeature } from "./goals-capability-panel-controls.js";

function createNode(attributes = {}) {
  const listeners = new Map();
  const retained = [];
  let scope = null;
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
      retained.push(handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    getAttribute(name) {
      return attributes[name] || null;
    },
    closest() {
      return scope;
    },
    setScope(value) {
      scope = value;
      return this;
    },
    getRetainedListener(index = 0) {
      return retained[index];
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function createPanel(entries = {}) {
  return {
    querySelectorAll(selector) {
      return entries[selector] || [];
    },
  };
}

function createForm(fields = {}) {
  return {
    querySelector(selector) {
      return fields[selector] || null;
    },
  };
}

describe("goals capability panel controls", () => {
  it("blocks a retained source listener after panel replacement", () => {
    const onOpenSourcePath = vi.fn();
    const controls = createGoalsCapabilityPanelControlsFeature({ onOpenSourcePath });
    const oldNode = createNode({ "data-open-source": "old.md" });
    const newNode = createNode({ "data-open-source": "new.md" });

    controls.bind(createPanel({ "[data-open-source]": [oldNode] }));
    const retainedOldListener = oldNode.getRetainedListener();
    controls.bind(createPanel({ "[data-open-source]": [newNode] }));

    retainedOldListener({ type: "click" });

    expect(onOpenSourcePath).not.toHaveBeenCalled();
    expect(oldNode.listenerCount).toBe(0);
    expect(controls.getRuntimeSnapshot()).toMatchObject({
      activeGroupCount: 1,
      activeListenerCount: 1,
      disposed: false,
    });
  });

  it("routes all active capability actions with their existing values", async () => {
    const onOpenSourcePath = vi.fn();
    const onOpenSubtask = vi.fn();
    const onSaveGovernanceSettings = vi.fn(async () => {});
    const onCommanderDecision = vi.fn(async () => {});
    const controls = createGoalsCapabilityPanelControlsFeature({
      onOpenSourcePath,
      onOpenSubtask,
      onSaveGovernanceSettings,
      onCommanderDecision,
    });
    const governanceForm = createForm({
      "[data-goal-capability-field='executionMode']": { value: "multi_agent" },
      "[data-goal-capability-field='governanceMode']": { value: "commander" },
      "[data-goal-capability-field='commanderAgentId']": { value: "commander-2" },
      "[data-goal-capability-field='preferredAgents']": { value: "coder, qa" },
      "[data-goal-capability-field='finalApprovalMode']": { value: "user_required" },
    });
    const commanderForm = createForm({
      "[data-goal-capability-field='decisionSummary']": { value: "Ready" },
      "[data-goal-capability-field='decisionNote']": { value: "Reviewed" },
      "[data-goal-capability-field='requireUserApproval']": { value: "user_required" },
    });
    const sourceNode = createNode({ "data-open-source": "out/result.md" });
    const subtaskNode = createNode({ "data-open-subtask-id": "task-1" });
    const saveNode = createNode({ "data-goal-id": "goal-1", "data-node-id": "node-1" }).setScope(governanceForm);
    const decisionNode = createNode({
      "data-goal-id": "goal-1",
      "data-node-id": "node-1",
      "data-goal-commander-decision": "accept",
    }).setScope(commanderForm);
    const prefillSummary = { value: "" };
    const prefillNote = { value: "" };
    const prefillForm = createForm({
      "[data-goal-capability-field='decisionSummary']": prefillSummary,
      "[data-goal-capability-field='decisionNote']": prefillNote,
    });
    const prefillNode = createNode({
      "data-goal-commander-prefill": "history",
      "data-prefill-history-summary": "Close after review",
      "data-prefill-history-note": "上一轮返工次数：2",
    }).setScope(prefillForm);

    controls.bind(createPanel({
      "[data-open-source]": [sourceNode],
      "[data-open-subtask-id]": [subtaskNode],
      "[data-goal-capability-save]": [saveNode],
      "[data-goal-commander-decision]": [decisionNode],
      "[data-goal-commander-prefill]": [prefillNode],
    }));

    sourceNode.getRetainedListener()({ type: "click" });
    subtaskNode.getRetainedListener()({ type: "click" });
    saveNode.getRetainedListener()({ type: "click" });
    decisionNode.getRetainedListener()({ type: "click" });
    prefillNode.getRetainedListener()({ type: "click" });
    await Promise.resolve();

    expect(onOpenSourcePath).toHaveBeenCalledWith("out/result.md");
    expect(onOpenSubtask).toHaveBeenCalledWith("task-1");
    expect(onSaveGovernanceSettings).toHaveBeenCalledWith("goal-1", "node-1", {
      executionMode: "multi_agent",
      governanceMode: "commander",
      commanderAgentId: "commander-2",
      preferredAgents: ["coder", "qa"],
      finalApprovalMode: "user_required",
    });
    expect(onCommanderDecision).toHaveBeenCalledWith("goal-1", "node-1", {
      decision: "accept",
      summary: "Ready",
      note: "Reviewed",
      requireUserApproval: true,
    });
    expect(prefillSummary.value).toBe("Close after review");
    expect(prefillNote.value).toBe("上一轮返工次数：2");
  });
});
