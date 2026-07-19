// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalsActionsRuntimeFeature } from "./goals-actions-runtime.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createGoalCreateRefs({ autoResume = false } = {}) {
  document.body.innerHTML = `
    <div id="create-modal"></div>
    <input id="create-title" />
    <textarea id="create-objective"></textarea>
    <input id="create-root" />
    <input id="create-auto-resume" type="checkbox" />
    <button id="create-submit">Create</button>
  `;
  const refs = {
    goalCreateModal: document.getElementById("create-modal"),
    goalCreateTitleEl: document.getElementById("create-title"),
    goalCreateObjectiveEl: document.getElementById("create-objective"),
    goalCreateRootEl: document.getElementById("create-root"),
    goalCreateAutoResumeEl: document.getElementById("create-auto-resume"),
    goalCreateSubmitBtn: document.getElementById("create-submit"),
  };
  refs.goalCreateAutoResumeEl.checked = autoResume;
  return refs;
}

describe("goals actions runtime UI lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("owns modal listeners and the delayed title focus until dispose", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="create-modal" class="hidden"></div>
      <input id="create-title" />
      <textarea id="create-objective"></textarea>
      <input id="create-root" />
      <input id="create-auto-resume" type="checkbox" />
      <button id="create-submit"></button>
      <div id="checkpoint-modal"></div>
      <input id="checkpoint-summary" />
      <textarea id="checkpoint-note"></textarea>
      <button id="checkpoint-submit"></button>
    `;
    const refs = {
      goalCreateModal: document.getElementById("create-modal"),
      goalCreateTitleEl: document.getElementById("create-title"),
      goalCreateObjectiveEl: document.getElementById("create-objective"),
      goalCreateRootEl: document.getElementById("create-root"),
      goalCreateAutoResumeEl: document.getElementById("create-auto-resume"),
      goalCreateSubmitBtn: document.getElementById("create-submit"),
      goalCheckpointActionModal: document.getElementById("checkpoint-modal"),
      goalCheckpointActionSummaryEl: document.getElementById("checkpoint-summary"),
      goalCheckpointActionNoteEl: document.getElementById("checkpoint-note"),
      goalCheckpointActionSubmitBtn: document.getElementById("checkpoint-submit"),
    };
    const goalsRuntime = {
      toggleGoalCheckpointActionModal: vi.fn(),
      submitGoalCheckpointActionForm: vi.fn(),
    };
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs,
      isConnected: () => false,
      getGoalsRuntimeFeature: () => goalsRuntime,
      showNotice,
    });

    feature.bindUi();
    feature.bindUi();
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 7,
      focusTimerPending: false,
      pendingRpcCount: 0,
      disposed: false,
    });

    feature.toggleGoalCreateModal(true);
    expect(refs.goalCreateModal.classList.contains("hidden")).toBe(false);
    expect(feature.getRuntimeSnapshot().focusTimerPending).toBe(true);
    refs.goalCreateTitleEl.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
    }));
    refs.goalCreateObjectiveEl.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      cancelable: true,
    }));
    expect(showNotice).toHaveBeenCalledTimes(2);

    refs.goalCreateModal.click();
    expect(refs.goalCreateModal.classList.contains("hidden")).toBe(true);
    expect(feature.getRuntimeSnapshot().focusTimerPending).toBe(false);
    refs.goalCheckpointActionSubmitBtn.click();
    refs.goalCheckpointActionModal.click();
    refs.goalCheckpointActionSummaryEl.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
    }));
    refs.goalCheckpointActionNoteEl.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      cancelable: true,
    }));
    expect(goalsRuntime.toggleGoalCheckpointActionModal).toHaveBeenCalledTimes(1);
    expect(goalsRuntime.toggleGoalCheckpointActionModal).toHaveBeenCalledWith(false, null);
    expect(goalsRuntime.submitGoalCheckpointActionForm).toHaveBeenCalledTimes(3);

    feature.toggleGoalCreateModal(true);
    refs.goalCreateTitleEl.value = "retained title";
    refs.goalCreateObjectiveEl.value = "retained objective";
    refs.goalCreateRootEl.value = "E:/retained";
    feature.dispose();
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      focusTimerPending: false,
      pendingRpcCount: 0,
      disposed: true,
    });
    expect(refs.goalCreateModal.classList.contains("hidden")).toBe(true);
    expect(refs.goalCreateTitleEl.value).toBe("");
    expect(refs.goalCreateObjectiveEl.value).toBe("");
    expect(refs.goalCreateRootEl.value).toBe("");

    refs.goalCreateTitleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    refs.goalCheckpointActionSubmitBtn.click();
    refs.goalCheckpointActionModal.click();
    feature.bindUi();
    feature.toggleGoalCreateModal(true);
    await feature.submitGoalCreateForm();
    await feature.submitGoalCheckpointActionForm();
    vi.runAllTimers();
    expect(showNotice).toHaveBeenCalledTimes(2);
    expect(goalsRuntime.toggleGoalCheckpointActionModal).toHaveBeenCalledTimes(1);
    expect(goalsRuntime.submitGoalCheckpointActionForm).toHaveBeenCalledTimes(3);
    expect(refs.goalCreateModal.classList.contains("hidden")).toBe(true);
  });

  it("keeps the normal approval scan settlement", async () => {
    const goal = { id: "goal-1" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload: { summary: "scan complete" } });
    const loadGoalReviewGovernanceData = vi.fn();
    const loadGoalTrackingData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      loadGoalReviewGovernanceData,
      loadGoalTrackingData,
      showNotice,
    });

    await feature.runGoalApprovalScan("goal-1");
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "goal.approval.scan",
      params: { goalId: "goal-1", autoEscalate: true },
    }));
    expect(loadGoalReviewGovernanceData).toHaveBeenCalledWith(goal);
    expect(loadGoalTrackingData).toHaveBeenCalledWith(goal);
    expect(showNotice).toHaveBeenCalledWith("审批扫描完成", "scan complete", "success");
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it("ignores a late approval scan response after dispose", async () => {
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoalReviewGovernanceData = vi.fn();
    const loadGoalTrackingData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      loadGoalReviewGovernanceData,
      loadGoalTrackingData,
      showNotice,
    });

    const scanPromise = feature.runGoalApprovalScan("goal-1");
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    deferred.resolve({ ok: true, payload: { summary: "late scan" } });
    await scanPromise;
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadGoalReviewGovernanceData).not.toHaveBeenCalled();
    expect(loadGoalTrackingData).not.toHaveBeenCalled();

    await feature.runGoalApprovalScan("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("keeps the normal suggestion review decision settlement", async () => {
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("reviewer-1")
      .mockReturnValueOnce("looks good");
    const goal = { id: "goal-1" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true });
    const loadGoalReviewGovernanceData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      getGoalActionActor: () => "default-reviewer",
      loadGoalReviewGovernanceData,
      showNotice,
    });

    await feature.runGoalSuggestionReviewDecision("goal-1", {
      reviewId: "review-1",
      suggestionType: "capability",
      suggestionId: "suggestion-1",
      decision: "approved",
    });
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.suggestion_review.decide",
      params: {
        goalId: "goal-1",
        reviewId: "review-1",
        suggestionType: "capability",
        suggestionId: "suggestion-1",
        decision: "approved",
        reviewer: "reviewer-1",
        decidedBy: "reviewer-1",
        note: "looks good",
      },
    });
    expect(showNotice).toHaveBeenCalledWith(
      "suggestion review 已提交",
      "approved 已写入审批流。",
      "success",
    );
    expect(loadGoalReviewGovernanceData).toHaveBeenCalledWith(goal);
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({ ok: true }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late failure")),
    },
  ])("ignores a late suggestion review decision $responseKind after dispose", async ({ settle }) => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("reviewer-1");
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoalReviewGovernanceData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      getGoalActionActor: () => "default-reviewer",
      loadGoalReviewGovernanceData,
      showNotice,
    });

    const decisionPromise = feature.runGoalSuggestionReviewDecision("goal-1", {
      reviewId: "review-1",
      decision: "approved",
    });
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(decisionPromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadGoalReviewGovernanceData).not.toHaveBeenCalled();

    await feature.runGoalSuggestionReviewDecision("goal-1", {
      reviewId: "review-1",
      decision: "approved",
    });
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("keeps the normal suggestion review escalation settlement", async () => {
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("reviewer-2")
      .mockReturnValueOnce("needs specialist review");
    const goal = { id: "goal-1" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true });
    const loadGoalReviewGovernanceData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      getGoalActionActor: () => "reviewer-1",
      loadGoalReviewGovernanceData,
      showNotice,
    });

    await feature.runGoalSuggestionReviewEscalation("goal-1", {
      reviewId: "review-1",
      suggestionType: "capability",
      suggestionId: "suggestion-1",
    });
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.suggestion_review.escalate",
      params: {
        goalId: "goal-1",
        reviewId: "review-1",
        suggestionType: "capability",
        suggestionId: "suggestion-1",
        escalatedBy: "reviewer-1",
        escalatedTo: "reviewer-2",
        reason: "needs specialist review",
        force: true,
      },
    });
    expect(showNotice).toHaveBeenCalledWith(
      "suggestion review 已升级",
      "当前审批 stage 已升级。",
      "success",
    );
    expect(loadGoalReviewGovernanceData).toHaveBeenCalledWith(goal);
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({ ok: true }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late escalation failure")),
    },
  ])("ignores a late suggestion review escalation $responseKind after dispose", async ({ settle }) => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("reviewer-2");
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoalReviewGovernanceData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      getGoalActionActor: () => "reviewer-1",
      loadGoalReviewGovernanceData,
      showNotice,
    });

    const escalationPromise = feature.runGoalSuggestionReviewEscalation("goal-1", {
      reviewId: "review-1",
    });
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(escalationPromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadGoalReviewGovernanceData).not.toHaveBeenCalled();

    await feature.runGoalSuggestionReviewEscalation("goal-1", { reviewId: "review-1" });
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("keeps the normal checkpoint escalation settlement", async () => {
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("reviewer-2")
      .mockReturnValueOnce("checkpoint needs specialist review");
    const goal = { id: "goal-1" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true });
    const loadGoalReviewGovernanceData = vi.fn();
    const loadGoalTrackingData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      getGoalActionActor: () => "reviewer-1",
      loadGoalReviewGovernanceData,
      loadGoalTrackingData,
      showNotice,
    });

    await feature.runGoalCheckpointEscalation("goal-1", "node-1", "checkpoint-1");
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.checkpoint.escalate",
      params: {
        goalId: "goal-1",
        nodeId: "node-1",
        checkpointId: "checkpoint-1",
        escalatedBy: "reviewer-1",
        escalatedTo: "reviewer-2",
        reason: "checkpoint needs specialist review",
        force: true,
      },
    });
    expect(showNotice).toHaveBeenCalledWith(
      "checkpoint 已升级",
      "当前 checkpoint 审批 stage 已升级。",
      "success",
    );
    expect(loadGoalReviewGovernanceData).toHaveBeenCalledWith(goal);
    expect(loadGoalTrackingData).toHaveBeenCalledWith(goal);
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({ ok: true }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late checkpoint escalation failure")),
    },
  ])("ignores a late checkpoint escalation $responseKind after dispose", async ({ settle }) => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("reviewer-2");
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoalReviewGovernanceData = vi.fn();
    const loadGoalTrackingData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      getGoalActionActor: () => "reviewer-1",
      loadGoalReviewGovernanceData,
      loadGoalTrackingData,
      showNotice,
    });

    const escalationPromise = feature.runGoalCheckpointEscalation(
      "goal-1",
      "node-1",
      "checkpoint-1",
    );
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(escalationPromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadGoalReviewGovernanceData).not.toHaveBeenCalled();
    expect(loadGoalTrackingData).not.toHaveBeenCalled();

    await feature.runGoalCheckpointEscalation("goal-1", "node-1", "checkpoint-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("keeps the normal capability governance save settlement", async () => {
    const goal = { id: "goal-1" };
    const plan = { executionMode: "commander" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload: { plan } });
    const loadGoalCapabilityData = vi.fn();
    const loadGoalTrackingData = vi.fn();
    const loadGoalReviewGovernanceData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      loadGoalCapabilityData,
      loadGoalTrackingData,
      loadGoalReviewGovernanceData,
      showNotice,
    });
    const input = {
      executionMode: "commander",
      governanceMode: "reviewed",
      commanderAgentId: "agent-1",
      preferredAgents: ["agent-1", "agent-2"],
      finalApprovalMode: "required",
    };

    await expect(feature.saveGoalCapabilityGovernance("goal-1", "node-1", input)).resolves.toBe(plan);
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.capability.update",
      params: {
        goalId: "goal-1",
        nodeId: "node-1",
        ...input,
      },
    });
    expect(showNotice).toHaveBeenCalledWith(
      "治理设置已保存",
      "当前节点的 capability governance 已更新。",
      "success",
    );
    expect(loadGoalCapabilityData).toHaveBeenCalledWith(goal);
    expect(loadGoalTrackingData).toHaveBeenCalledWith(goal);
    expect(loadGoalReviewGovernanceData).toHaveBeenCalledWith(goal);
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({ ok: true, payload: { plan: { id: "late-plan" } } }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late governance failure")),
    },
  ])("ignores a late capability governance save $responseKind after dispose", async ({ settle }) => {
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoalCapabilityData = vi.fn();
    const loadGoalTrackingData = vi.fn();
    const loadGoalReviewGovernanceData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      loadGoalCapabilityData,
      loadGoalTrackingData,
      loadGoalReviewGovernanceData,
      showNotice,
    });

    const savePromise = feature.saveGoalCapabilityGovernance("goal-1", "node-1", {});
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(savePromise).resolves.toBeNull();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadGoalCapabilityData).not.toHaveBeenCalled();
    expect(loadGoalTrackingData).not.toHaveBeenCalled();
    expect(loadGoalReviewGovernanceData).not.toHaveBeenCalled();

    await expect(feature.saveGoalCapabilityGovernance("goal-1", "node-1", {})).resolves.toBeNull();
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("keeps the normal commander decision settlement", async () => {
    const goal = { id: "goal-1" };
    const payload = { decisionId: "decision-1" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload });
    const loadGoalCapabilityData = vi.fn();
    const loadGoalTrackingData = vi.fn();
    const loadGoalReviewGovernanceData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      loadGoalCapabilityData,
      loadGoalTrackingData,
      loadGoalReviewGovernanceData,
      showNotice,
    });
    const input = {
      decision: "approve",
      summary: "ready to proceed",
      note: "checked",
      requireUserApproval: true,
    };

    await expect(feature.runGoalCommanderDecision("goal-1", "node-1", input)).resolves.toBe(payload);
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.capability.commander_decide",
      params: {
        goalId: "goal-1",
        nodeId: "node-1",
        ...input,
      },
    });
    expect(showNotice).toHaveBeenCalledWith(
      "Commander 决策已提交",
      "approve 已写入 capability governance。",
      "success",
    );
    expect(loadGoalCapabilityData).toHaveBeenCalledWith(goal);
    expect(loadGoalTrackingData).toHaveBeenCalledWith(goal);
    expect(loadGoalReviewGovernanceData).toHaveBeenCalledWith(goal);
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({ ok: true, payload: { decisionId: "late-decision" } }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late commander failure")),
    },
  ])("ignores a late commander decision $responseKind after dispose", async ({ settle }) => {
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoalCapabilityData = vi.fn();
    const loadGoalTrackingData = vi.fn();
    const loadGoalReviewGovernanceData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      loadGoalCapabilityData,
      loadGoalTrackingData,
      loadGoalReviewGovernanceData,
      showNotice,
    });

    const decisionPromise = feature.runGoalCommanderDecision("goal-1", "node-1", {
      decision: "approve",
    });
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(decisionPromise).resolves.toBeNull();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadGoalCapabilityData).not.toHaveBeenCalled();
    expect(loadGoalTrackingData).not.toHaveBeenCalled();
    expect(loadGoalReviewGovernanceData).not.toHaveBeenCalled();

    await expect(feature.runGoalCommanderDecision("goal-1", "node-1", {
      decision: "approve",
    })).resolves.toBeNull();
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("keeps the normal handoff generation settlement", async () => {
    const goal = { id: "goal-1", title: "Goal One" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true });
    const loadGoalHandoffData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      loadGoalHandoffData,
      showNotice,
    });

    await feature.generateGoalHandoff("goal-1");
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.handoff.generate",
      params: { goalId: "goal-1" },
    });
    expect(loadGoalHandoffData).toHaveBeenCalledWith(goal);
    expect(showNotice).toHaveBeenCalledWith(
      "Handoff generated",
      "The recovery handoff summary for Goal One has been updated.",
      "success",
      2200,
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({ ok: true }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late handoff failure")),
    },
  ])("ignores a late handoff generation $responseKind after dispose", async ({ settle }) => {
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoalHandoffData = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1", title: "Goal One" }),
      loadGoalHandoffData,
      showNotice,
    });

    const handoffPromise = feature.generateGoalHandoff("goal-1");
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(handoffPromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadGoalHandoffData).not.toHaveBeenCalled();

    await feature.generateGoalHandoff("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("keeps the normal goal resume settlement", async () => {
    const goal = { id: "goal-1", title: "Goal One" };
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { goal, conversationId: "conversation-1" },
    });
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const openConversationSession = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      loadGoals,
      openConversationSession,
      goalBaseConversationId: () => "fallback-conversation",
      showNotice,
    });

    await feature.resumeGoal("goal-1", {
      nodeId: " node-1 ",
      checkpointId: " checkpoint-1 ",
    });
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.resume",
      params: { goalId: "goal-1", nodeId: "node-1", checkpointId: "checkpoint-1" },
    });
    expect(loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(openConversationSession).toHaveBeenCalledWith(
      "conversation-1",
      "Entered long task node channel: Goal One / node-1",
    );
    expect(showNotice).toHaveBeenCalledWith(
      "Long task resumed",
      "Goal One replayed checkpoint checkpoint-1 and resumed node node-1.",
      "success",
      2200,
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it("keeps silent resume from showing a notice", async () => {
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: {
        goal: { id: "goal-1", title: "Goal One" },
        conversationId: "conversation-1",
      },
    });
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const openConversationSession = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => null,
      loadGoals,
      openConversationSession,
      goalBaseConversationId: () => "fallback-conversation",
      showNotice,
    });

    await feature.resumeGoal("goal-1", { silent: true });
    expect(openConversationSession).toHaveBeenCalledWith(
      "conversation-1",
      "Entered long task channel: Goal One",
    );
    expect(showNotice).not.toHaveBeenCalled();
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({
        ok: true,
        payload: { goal: { id: "goal-1" }, conversationId: "conversation-1" },
      }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late resume failure")),
    },
  ])("ignores a late goal resume $responseKind after dispose", async ({ settle }) => {
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const openConversationSession = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      loadGoals,
      openConversationSession,
      goalBaseConversationId: () => "fallback-conversation",
      showNotice,
    });

    const resumePromise = feature.resumeGoal("goal-1");
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(resumePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(loadGoals).not.toHaveBeenCalled();
    expect(openConversationSession).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();

    await feature.resumeGoal("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("does not open a goal conversation when dispose wins during goal reload", async () => {
    const reloadDeferred = createDeferred();
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { goal: { id: "goal-1" }, conversationId: "conversation-1" },
    });
    const loadGoals = vi.fn(() => reloadDeferred.promise);
    const openConversationSession = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      loadGoals,
      openConversationSession,
      goalBaseConversationId: () => "fallback-conversation",
      showNotice,
    });

    const resumePromise = feature.resumeGoal("goal-1");
    await Promise.resolve();
    expect(loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    reloadDeferred.resolve(undefined);
    await expect(resumePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(openConversationSession).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("keeps the normal goal pause settlement", async () => {
    const goal = { id: "goal-1", title: "Goal One" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload: { goal } });
    const setActiveConversationId = vi.fn();
    const renderCanvasGoalContext = vi.fn();
    const resetStreamingState = vi.fn();
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext,
      getChatEventsFeature: () => ({ resetStreamingState }),
      loadGoals,
      showNotice,
    });

    await feature.pauseGoal("goal-1");
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.pause",
      params: { goalId: "goal-1" },
    });
    expect(setActiveConversationId).toHaveBeenCalledWith(null);
    expect(renderCanvasGoalContext).toHaveBeenCalledTimes(1);
    expect(resetStreamingState).toHaveBeenCalledTimes(1);
    expect(loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(showNotice).toHaveBeenCalledWith(
      "Long task paused",
      "Goal One has been paused. The normal chat channel is unaffected.",
      "info",
      2400,
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({
        ok: true,
        payload: { goal: { id: "goal-1", title: "Goal One" } },
      }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late pause failure")),
    },
  ])("ignores a late goal pause $responseKind after dispose", async ({ settle }) => {
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const setActiveConversationId = vi.fn();
    const renderCanvasGoalContext = vi.fn();
    const resetStreamingState = vi.fn();
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext,
      getChatEventsFeature: () => ({ resetStreamingState }),
      loadGoals,
      showNotice,
    });

    const pausePromise = feature.pauseGoal("goal-1");
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(pausePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(setActiveConversationId).not.toHaveBeenCalled();
    expect(renderCanvasGoalContext).not.toHaveBeenCalled();
    expect(resetStreamingState).not.toHaveBeenCalled();
    expect(loadGoals).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();

    await feature.pauseGoal("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("does not show a pause notice when dispose wins during goal reload", async () => {
    const reloadDeferred = createDeferred();
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { goal: { id: "goal-1", title: "Goal One" } },
    });
    const setActiveConversationId = vi.fn();
    const resetStreamingState = vi.fn();
    const loadGoals = vi.fn(() => reloadDeferred.promise);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext: vi.fn(),
      getChatEventsFeature: () => ({ resetStreamingState }),
      loadGoals,
      showNotice,
    });

    const pausePromise = feature.pauseGoal("goal-1");
    await Promise.resolve();
    expect(setActiveConversationId).toHaveBeenCalledWith(null);
    expect(resetStreamingState).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    reloadDeferred.resolve(undefined);
    await expect(pausePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("keeps the normal goal archive settlement", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("completed");
    const goal = { id: "goal-1", title: "Goal One" };
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload: { goal } });
    const setActiveConversationId = vi.fn();
    const renderCanvasGoalContext = vi.fn();
    const resetStreamingState = vi.fn();
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext,
      getChatEventsFeature: () => ({ resetStreamingState }),
      loadGoals,
      showNotice,
    });

    await feature.archiveGoal("goal-1");
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.archive",
      params: { goalId: "goal-1", reason: "completed" },
    });
    expect(setActiveConversationId).toHaveBeenCalledWith(null);
    expect(renderCanvasGoalContext).toHaveBeenCalledTimes(1);
    expect(resetStreamingState).toHaveBeenCalledTimes(1);
    expect(loadGoals).toHaveBeenCalledWith(true);
    expect(showNotice).toHaveBeenCalledWith(
      "Long task archived",
      "Goal One has been archived.",
      "info",
      2400,
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it("stops archive input collection when confirm disposes the owner", async () => {
    let feature;
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("late reason");
    const sendReq = vi.fn().mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockImplementation(() => {
      feature.dispose();
      return true;
    });
    feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      showNotice: vi.fn(),
    });

    await feature.archiveGoal("goal-1");
    expect(prompt).not.toHaveBeenCalled();
    expect(sendReq).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: true });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({
        ok: true,
        payload: { goal: { id: "goal-1", title: "Goal One" } },
      }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late archive failure")),
    },
  ])("ignores a late goal archive $responseKind after dispose", async ({ settle }) => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("completed");
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const setActiveConversationId = vi.fn();
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext: vi.fn(),
      getChatEventsFeature: () => ({ resetStreamingState: vi.fn() }),
      loadGoals,
      showNotice,
    });

    const archivePromise = feature.archiveGoal("goal-1");
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(archivePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(setActiveConversationId).not.toHaveBeenCalled();
    expect(loadGoals).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();

    await feature.archiveGoal("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("does not show an archive notice when dispose wins during goal reload", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("completed");
    const reloadDeferred = createDeferred();
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { goal: { id: "goal-1", title: "Goal One" } },
    });
    const setActiveConversationId = vi.fn();
    const resetStreamingState = vi.fn();
    const loadGoals = vi.fn(() => reloadDeferred.promise);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext: vi.fn(),
      getChatEventsFeature: () => ({ resetStreamingState }),
      loadGoals,
      showNotice,
    });

    const archivePromise = feature.archiveGoal("goal-1");
    await Promise.resolve();
    expect(setActiveConversationId).toHaveBeenCalledWith(null);
    expect(resetStreamingState).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    reloadDeferred.resolve(undefined);
    await expect(archivePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("keeps the normal goal create settlement without auto-resume", async () => {
    const refs = createGoalCreateRefs();
    refs.goalCreateTitleEl.value = " Goal One ";
    refs.goalCreateObjectiveEl.value = " Objective ";
    refs.goalCreateRootEl.value = " E:/goals/one ";
    const requestDeferred = createDeferred();
    const sendReq = vi.fn(() => requestDeferred.promise);
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs,
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      loadGoals,
      showNotice,
    });

    const createPromise = feature.submitGoalCreateForm();
    expect(refs.goalCreateSubmitBtn.disabled).toBe(true);
    expect(refs.goalCreateSubmitBtn.textContent).toBe("Creating...");
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    requestDeferred.resolve({
      ok: true,
      payload: { goal: { id: "goal-1", title: "Goal One" } },
    });
    await createPromise;
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.create",
      params: {
        title: "Goal One",
        objective: "Objective",
        goalRoot: "E:/goals/one",
      },
    });
    expect(refs.goalCreateSubmitBtn.disabled).toBe(false);
    expect(refs.goalCreateSubmitBtn.textContent).toBe("Create");
    expect(refs.goalCreateModal.classList.contains("hidden")).toBe(true);
    expect(loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(showNotice).toHaveBeenCalledWith(
      "Long task created",
      "Goal One was created and is ready to enter its execution channel.",
      "success",
      2200,
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it("keeps create auto-resume on the owned resume lifecycle", async () => {
    const refs = createGoalCreateRefs({ autoResume: true });
    refs.goalCreateTitleEl.value = "Goal One";
    const goal = { id: "goal-1", title: "Goal One" };
    const sendReq = vi.fn(async (request) => {
      if (request.method === "goal.create") return { ok: true, payload: { goal } };
      return { ok: true, payload: { goal, conversationId: "conversation-1" } };
    });
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const openConversationSession = vi.fn();
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs,
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      loadGoals,
      goalBaseConversationId: () => "fallback-conversation",
      openConversationSession,
      showNotice,
    });

    await feature.submitGoalCreateForm();
    expect(sendReq.mock.calls.map(([request]) => request.method)).toEqual([
      "goal.create",
      "goal.resume",
    ]);
    expect(loadGoals).toHaveBeenNthCalledWith(1, true, "goal-1");
    expect(loadGoals).toHaveBeenNthCalledWith(2, true, "goal-1");
    expect(openConversationSession).toHaveBeenCalledWith(
      "conversation-1",
      "Entered long task channel: Goal One",
    );
    expect(showNotice).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({
        ok: true,
        payload: { goal: { id: "goal-1", title: "Goal One" } },
      }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late create failure")),
    },
  ])("ignores a late goal create $responseKind after dispose", async ({ settle }) => {
    const refs = createGoalCreateRefs({ autoResume: true });
    refs.goalCreateTitleEl.value = "Goal One";
    refs.goalCreateObjectiveEl.value = "Objective";
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs,
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      loadGoals,
      showNotice,
    });

    const createPromise = feature.submitGoalCreateForm();
    expect(refs.goalCreateSubmitBtn.disabled).toBe(true);
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(refs.goalCreateSubmitBtn.disabled).toBe(false);
    expect(refs.goalCreateSubmitBtn.textContent).toBe("Create");
    expect(refs.goalCreateTitleEl.value).toBe("");
    expect(refs.goalCreateObjectiveEl.value).toBe("");
    expect(refs.goalCreateModal.classList.contains("hidden")).toBe(true);
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(createPromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(loadGoals).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();

    await feature.submitGoalCreateForm();
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("does not auto-resume when dispose wins during post-create reload", async () => {
    const refs = createGoalCreateRefs({ autoResume: true });
    refs.goalCreateTitleEl.value = "Goal One";
    const reloadDeferred = createDeferred();
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { goal: { id: "goal-1", title: "Goal One" } },
    });
    const loadGoals = vi.fn(() => reloadDeferred.promise);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs,
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      loadGoals,
      showNotice,
    });

    const createPromise = feature.submitGoalCreateForm();
    await Promise.resolve();
    expect(loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(showNotice).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    reloadDeferred.resolve(undefined);
    await expect(createPromise).resolves.toBeUndefined();
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
  });

  it("settles create and nested resume tokens after dispose", async () => {
    const refs = createGoalCreateRefs({ autoResume: true });
    refs.goalCreateTitleEl.value = "Goal One";
    const resumeDeferred = createDeferred();
    const goal = { id: "goal-1", title: "Goal One" };
    const sendReq = vi.fn((request) => request.method === "goal.create"
      ? Promise.resolve({ ok: true, payload: { goal } })
      : resumeDeferred.promise);
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const openConversationSession = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs,
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      loadGoals,
      goalBaseConversationId: () => "fallback-conversation",
      openConversationSession,
      showNotice: vi.fn(),
    });

    const createPromise = feature.submitGoalCreateForm();
    await vi.waitFor(() => expect(sendReq).toHaveBeenCalledTimes(2));
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(2);
    feature.dispose();
    resumeDeferred.resolve({
      ok: true,
      payload: { goal, conversationId: "conversation-1" },
    });
    await expect(createPromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: true });
    expect(openConversationSession).not.toHaveBeenCalled();
  });

  it("keeps delete preview warnings when the user cancels commit", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const prompt = vi.spyOn(window, "prompt");
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { storagePreview: { warnings: ["shared artifact remains"] } },
    });
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1", title: "Goal One" }),
      showNotice: vi.fn(),
    });

    await feature.deleteGoal("goal-1");
    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "goal.delete",
      params: { goalId: "goal-1", preview: true },
    });
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("shared artifact remains"));
    expect(prompt).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it("stops delete input collection when confirm disposes the owner", async () => {
    let feature;
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("goal-1");
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload: {} });
    vi.spyOn(window, "confirm").mockImplementation(() => {
      feature.dispose();
      return true;
    });
    feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      showNotice: vi.fn(),
    });

    await feature.deleteGoal("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: true });
  });

  it("stops delete commit when confirm text collection disposes the owner", async () => {
    let feature;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockImplementation(() => {
      feature.dispose();
      return "goal-1";
    });
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload: {} });
    feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      showNotice: vi.fn(),
    });

    await feature.deleteGoal("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: true });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({ ok: true, payload: {} }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late delete preview failure")),
    },
  ])("ignores a late delete preview $responseKind after dispose", async ({ settle }) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("goal-1");
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      showNotice,
    });

    const deletePromise = feature.deleteGoal("goal-1");
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(deferred);
    await expect(deletePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();

    await feature.deleteGoal("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("keeps the normal delete commit and cleanup warning settlement", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("goal-1");
    const goal = { id: "goal-1", title: "Goal One" };
    const sendReq = vi.fn(async (request) => request.params.preview
      ? { ok: true, payload: { storagePreview: { warnings: [] } } }
      : { ok: true, payload: { cleanupWarnings: ["artifact cleanup deferred"] } });
    const setActiveConversationId = vi.fn();
    const resetStreamingState = vi.fn();
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => goal,
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext: vi.fn(),
      getChatEventsFeature: () => ({ resetStreamingState }),
      loadGoals,
      showNotice,
    });

    await feature.deleteGoal("goal-1");
    expect(sendReq).toHaveBeenCalledTimes(2);
    expect(sendReq).toHaveBeenNthCalledWith(2, {
      type: "req",
      id: "request-1",
      method: "goal.delete",
      params: { goalId: "goal-1", confirmText: "goal-1" },
    });
    expect(setActiveConversationId).toHaveBeenCalledWith(null);
    expect(resetStreamingState).toHaveBeenCalledTimes(1);
    expect(loadGoals).toHaveBeenCalledWith(true);
    expect(showNotice).toHaveBeenCalledWith(
      "Long task deleted with cleanup warnings",
      "Goal One has been permanently deleted. artifact cleanup deferred",
      "warning",
      4800,
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 0, disposed: false });
  });

  it.each([
    {
      responseKind: "successful response",
      settle: (deferred) => deferred.resolve({ ok: true, payload: {} }),
    },
    {
      responseKind: "rejected request",
      settle: (deferred) => deferred.reject(new Error("late delete commit failure")),
    },
  ])("ignores a late delete commit $responseKind after dispose", async ({ settle }) => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("goal-1");
    const commitDeferred = createDeferred();
    const sendReq = vi.fn((request) => request.params.preview
      ? Promise.resolve({ ok: true, payload: {} })
      : commitDeferred.promise);
    const setActiveConversationId = vi.fn();
    const loadGoals = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext: vi.fn(),
      getChatEventsFeature: () => ({ resetStreamingState: vi.fn() }),
      loadGoals,
      showNotice,
    });

    const deletePromise = feature.deleteGoal("goal-1");
    await vi.waitFor(() => expect(sendReq).toHaveBeenCalledTimes(2));
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingRpcCount: 1, disposed: true });
    settle(commitDeferred);
    await expect(deletePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(setActiveConversationId).not.toHaveBeenCalled();
    expect(loadGoals).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("does not show a delete notice when dispose wins during goal reload", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("goal-1");
    const reloadDeferred = createDeferred();
    const sendReq = vi.fn(async (request) => request.params.preview
      ? { ok: true, payload: {} }
      : { ok: true, payload: { cleanupWarnings: [] } });
    const setActiveConversationId = vi.fn();
    const resetStreamingState = vi.fn();
    const loadGoals = vi.fn(() => reloadDeferred.promise);
    const showNotice = vi.fn();
    const feature = createGoalsActionsRuntimeFeature({
      refs: {},
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getGoalById: () => ({ id: "goal-1" }),
      isConversationForGoal: () => true,
      getActiveConversationId: () => "conversation-1",
      setActiveConversationId,
      renderCanvasGoalContext: vi.fn(),
      getChatEventsFeature: () => ({ resetStreamingState }),
      loadGoals,
      showNotice,
    });

    const deletePromise = feature.deleteGoal("goal-1");
    await vi.waitFor(() => expect(loadGoals).toHaveBeenCalledWith(true));
    expect(setActiveConversationId).toHaveBeenCalledWith(null);
    expect(resetStreamingState).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(1);
    feature.dispose();
    reloadDeferred.resolve(undefined);
    await expect(deletePromise).resolves.toBeUndefined();
    expect(feature.getRuntimeSnapshot().pendingRpcCount).toBe(0);
    expect(showNotice).not.toHaveBeenCalled();
  });
});
