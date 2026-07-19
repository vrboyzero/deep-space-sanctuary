// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalsRuntimeFeature } from "./goals-runtime.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createFixture({ sendReq = vi.fn().mockResolvedValue({ ok: true }) } = {}) {
  document.body.innerHTML = `
    <section id="goals"></section>
    <div id="detail"></div>
    <div id="modal" class="hidden"></div>
    <h2 id="title"></h2>
    <p id="hint"></p>
    <div id="context"></div>
    <input id="reviewer" />
    <input id="reviewer-role" />
    <input id="requested-by" />
    <label id="actor-label"></label>
    <input id="actor" />
    <input id="sla" />
    <input id="summary" />
    <label id="note-label"></label>
    <span id="note-help"></span>
    <textarea id="note"></textarea>
    <button id="close"></button>
    <button id="cancel"></button>
    <button id="submit"></button>
  `;
  const refs = {
    goalsSection: document.getElementById("goals"),
    goalsDetailEl: document.getElementById("detail"),
    goalCheckpointActionModal: document.getElementById("modal"),
    goalCheckpointActionTitleEl: document.getElementById("title"),
    goalCheckpointActionHintEl: document.getElementById("hint"),
    goalCheckpointActionContextEl: document.getElementById("context"),
    goalCheckpointActionReviewerEl: document.getElementById("reviewer"),
    goalCheckpointActionReviewerRoleEl: document.getElementById("reviewer-role"),
    goalCheckpointActionRequestedByEl: document.getElementById("requested-by"),
    goalCheckpointActionActorLabelEl: document.getElementById("actor-label"),
    goalCheckpointActionActorEl: document.getElementById("actor"),
    goalCheckpointActionSlaAtEl: document.getElementById("sla"),
    goalCheckpointActionSummaryEl: document.getElementById("summary"),
    goalCheckpointActionNoteLabelEl: document.getElementById("note-label"),
    goalCheckpointActionNoteHelpEl: document.getElementById("note-help"),
    goalCheckpointActionNoteEl: document.getElementById("note"),
    goalCheckpointActionCloseBtn: document.getElementById("close"),
    goalCheckpointActionCancelBtn: document.getElementById("cancel"),
    goalCheckpointActionSubmitBtn: document.getElementById("submit"),
  };
  const loadGoals = vi.fn().mockResolvedValue(undefined);
  const showNotice = vi.fn();
  const feature = createGoalsRuntimeFeature({
    refs,
    isConnected: () => true,
    sendReq,
    makeId: () => "request-1",
    getGoalsState: () => ({ trackingCheckpoints: [] }),
    getGoalById: () => null,
    loadGoals,
    showNotice,
    formatDateTime: (value) => String(value || ""),
    escapeHtml: (value) => String(value || ""),
  });
  return { feature, loadGoals, refs, sendReq, showNotice };
}

function openApproveModal(feature) {
  feature.toggleGoalCheckpointActionModal(true, {
    action: "approve",
    goalId: "goal-1",
    nodeId: "node-1",
    checkpointId: "checkpoint-1",
    reviewer: "reviewer-1",
    summary: "ready",
  });
}

describe("goals runtime checkpoint modal lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("keeps the normal focus and successful submit settlement", async () => {
    vi.useFakeTimers();
    const { feature, loadGoals, refs, sendReq, showNotice } = createFixture();

    openApproveModal(feature);
    expect(feature.getRuntimeSnapshot()).toEqual({
      focusTimerPending: true,
      pendingRequestCount: 0,
      hasPendingAction: true,
      disposed: false,
    });
    vi.runAllTimers();
    expect(document.activeElement).toBe(refs.goalCheckpointActionSummaryEl);

    await feature.submitGoalCheckpointActionForm();
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "goal.checkpoint.approve",
      params: expect.objectContaining({ goalId: "goal-1", checkpointId: "checkpoint-1" }),
    }));
    expect(loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(showNotice).toHaveBeenCalledTimes(1);
    expect(refs.goalCheckpointActionModal.classList.contains("hidden")).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({
      focusTimerPending: false,
      pendingRequestCount: 0,
      hasPendingAction: false,
      disposed: false,
    });
  });

  it("clears modal content and ignores a late submit response after dispose", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const { feature, loadGoals, refs, showNotice } = createFixture({ sendReq });

    openApproveModal(feature);
    const submitPromise = feature.submitGoalCheckpointActionForm();
    expect(refs.goalCheckpointActionSubmitBtn.disabled).toBe(true);
    expect(feature.getRuntimeSnapshot().pendingRequestCount).toBe(1);

    feature.dispose();
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toEqual({
      focusTimerPending: false,
      pendingRequestCount: 1,
      hasPendingAction: false,
      disposed: true,
    });
    expect(refs.goalCheckpointActionModal.classList.contains("hidden")).toBe(true);
    expect(refs.goalCheckpointActionContextEl.innerHTML).toBe("");
    expect(refs.goalCheckpointActionReviewerEl.value).toBe("");
    expect(refs.goalCheckpointActionSummaryEl.value).toBe("");
    expect(refs.goalCheckpointActionNoteEl.value).toBe("");
    expect(refs.goalCheckpointActionSubmitBtn.disabled).toBe(false);

    deferred.resolve({ ok: true });
    await submitPromise;
    vi.runAllTimers();
    expect(feature.getRuntimeSnapshot().pendingRequestCount).toBe(0);
    expect(loadGoals).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();

    openApproveModal(feature);
    await feature.submitGoalCheckpointActionForm();
    await feature.runGoalCheckpointAction("goal-1", "node-1", "checkpoint-1", "approve");
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(refs.goalCheckpointActionModal.classList.contains("hidden")).toBe(true);
  });
});
