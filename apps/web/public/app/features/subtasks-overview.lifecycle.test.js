// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSubtasksOverviewFeature } from "./subtasks-overview.js";

function createHarness(stateOverrides = {}, options = {}) {
  const subtasksState = {
    items: [],
    selectedId: null,
    selectedItem: null,
    includeArchived: false,
    conversationId: "",
    loadSeq: 0,
    detailSeq: 0,
    liveUpdatePending: {},
    liveUpdateTimers: {},
    liveUpdateDelayMs: 120,
    ...stateOverrides,
  };
  const feature = createSubtasksOverviewFeature({
    refs: options.refs || {},
    isConnected: options.isConnected || (() => true),
    isViewActive: options.isViewActive || (() => false),
    sendReq: options.sendReq || vi.fn(),
    makeId: () => "request-1",
    getSubtasksState: () => subtasksState,
    getActiveConversationId: () => "",
    escapeHtml: options.escapeHtml || ((value) => String(value)),
    formatDateTime: (value) => String(value),
    summarizeSourcePath: (value) => String(value),
  });
  return { subtasksState, feature };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("subtasks overview live-update lifecycle", () => {
  it("renders list RPC errors as empty-state text without parsing HTML", async () => {
    const maliciousError = '<img src=x onerror="alert(1)">subtask list failed';
    document.body.innerHTML = `
      <section id="subtasksSection">
        <div id="subtasksSummary"></div>
        <div id="subtasksList"></div>
        <div id="subtasksDetail"></div>
      </section>
    `;
    const refs = {
      subtasksSection: document.querySelector("#subtasksSection"),
      subtasksSummaryEl: document.querySelector("#subtasksSummary"),
      subtasksListEl: document.querySelector("#subtasksList"),
      subtasksDetailEl: document.querySelector("#subtasksDetail"),
    };
    const { feature } = createHarness({}, {
      refs,
      sendReq: vi.fn(async () => ({ ok: false, error: { message: maliciousError } })),
      escapeHtml(value) {
        if (value === maliciousError) {
          throw new Error("SubTask error placeholders must not require an HTML escaper");
        }
        return String(value ?? "");
      },
    });

    await expect(feature.loadSubtasks()).resolves.toBeUndefined();

    expect(refs.subtasksListEl.children).toHaveLength(1);
    expect(refs.subtasksListEl.firstElementChild.className).toBe("memory-viewer-empty");
    expect(refs.subtasksListEl.firstElementChild.textContent).toBe(maliciousError);
    expect(refs.subtasksListEl.querySelector("img, [onerror]")).toBeNull();
    expect(refs.subtasksDetailEl.children).toHaveLength(1);
    expect(refs.subtasksDetailEl.firstElementChild.className).toBe("memory-viewer-empty");
    expect(refs.subtasksDetailEl.firstElementChild.textContent).toBe("Select a subtask on the left to view details.");
    expect(refs.subtasksDetailEl.querySelector("img, [onerror]")).toBeNull();
    feature.dispose();
  });

  it("coalesces updates and releases settled timer entries", async () => {
    vi.useFakeTimers();
    const { subtasksState, feature } = createHarness({
      items: [{ id: "task-1", name: "Old", createdAt: 1 }],
      selectedId: "task-1",
    });

    feature.handleSubtaskUpdate({ item: { id: "task-1", name: "First", createdAt: 1 } });
    feature.handleSubtaskUpdate({ item: { id: "task-1", name: "Latest", createdAt: 1 } });
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 1,
      activeTimerCount: 1,
      disposed: false,
    });

    await vi.advanceTimersByTimeAsync(120);
    expect(subtasksState.items).toEqual([
      expect.objectContaining({ id: "task-1", name: "Latest" }),
    ]);
    expect(subtasksState.selectedItem).toEqual(
      expect.objectContaining({ id: "task-1", name: "Latest" }),
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      activeTimerCount: 0,
    });
  });

  it("clears pending payloads and timers on dispose", async () => {
    vi.useFakeTimers();
    const { subtasksState, feature } = createHarness();

    feature.handleSubtaskUpdate({ item: { id: "task-1", name: "One", createdAt: 1 } });
    feature.handleSubtaskUpdate({ item: { id: "task-2", name: "Two", createdAt: 2 } });
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 2,
      activeTimerCount: 2,
    });

    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      activeTimerCount: 0,
      disposed: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(500);
    feature.handleSubtaskUpdate({ item: { id: "task-3", name: "Late", createdAt: 3 } });
    expect(subtasksState.items).toHaveLength(0);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      activeTimerCount: 0,
    });
  });
});
