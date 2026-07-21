// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSubtasksOverviewFeature } from "./subtasks-overview.js";

afterEach(() => {
  document.body.replaceChildren();
});

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("SubTasks list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createFeature(subtasksListEl, subtasksState, sendReq = vi.fn(async () => ({
  ok: false,
  error: { message: "detail failed" },
}))) {
  const feature = createSubtasksOverviewFeature({
    refs: {
      subtasksSection: null,
      subtasksSummaryEl: null,
      subtasksListEl,
      subtasksDetailEl: null,
    },
    isConnected: () => true,
    isViewActive: () => true,
    sendReq,
    makeId: () => "request-1",
    getSubtasksState: () => subtasksState,
    getActiveConversationId: () => "conversation-current",
    escapeHtml: (value) => String(value ?? ""),
    formatDateTime: (value) => `<time>${String(value ?? "")}</time>`,
    summarizeSourcePath: (value) => `<img src=x onerror=alert(1)>${String(value ?? "")}`,
    onOpenSourcePath: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenGoal: vi.fn(),
    onOpenContinuationAction: vi.fn(),
    getSelectedAgentId: () => "",
    showNotice: vi.fn(),
    t: (key, _params, fallback) => `<mark data-key="${key}">${fallback}</mark>`,
  });
  return { feature, sendReq };
}

describe("SubTasks full list DOM owner", () => {
  it("renders fields, states, attributes, and click selection without an HTML parser", async () => {
    const list = document.createElement("div");
    document.body.append(list);
    blockNonEmptyInnerHtml(list);
    const taskId = 'task"><img src=x onerror=alert(1)>';
    const sessionId = 'session"><script>alert(1)</script>';
    const subtasksState = {
      items: [
        {
          id: taskId,
          sessionId,
          parentConversationId: "conversation-current",
          status: "running",
          agentId: "<b>agent</b>",
          progress: { message: "<svg onload=alert(1)>progress</svg>" },
          summary: "ignored summary",
          instruction: "ignored instruction",
          updatedAt: "2026-07-20T00:00:00Z",
          outputPath: 'C:\\output\"><img>',
        },
        {
          id: "task-archived",
          parentConversationId: "conversation-other",
          status: "timeout",
          agentId: "agent-2",
          summary: "<script>summary</script>",
          createdAt: "2026-07-19T00:00:00Z",
          archivedAt: "2026-07-20T01:00:00Z",
        },
        {
          id: "task-fallback",
          parentConversationId: "conversation-other",
          status: "stopped",
          agentId: "agent-3",
        },
      ],
      selectedId: taskId,
      selectedItem: null,
      includeArchived: true,
      conversationId: "",
      continuationFocusSessionId: `  ${sessionId}  `,
      loadSeq: 0,
      detailSeq: 0,
      liveUpdatePending: {},
      liveUpdateTimers: {},
    };
    const { feature, sendReq } = createFeature(list, subtasksState);

    expect(() => feature.renderSubtaskList(subtasksState.items)).not.toThrow();
    const items = [...list.querySelectorAll(".subtask-list-item")];
    expect(items).toHaveLength(3);
    expect(items[0].className).toBe("memory-list-item subtask-list-item active is-continuation-focus");
    expect(items[0].getAttribute("data-subtask-id")).toBe(taskId);
    expect(items[0].getAttribute("data-subtask-session-id")).toBe(sessionId);
    expect(items[0].querySelector(".memory-badge-shared")?.textContent).toContain("current");
    expect(items[0].querySelector(".subtask-status-badge")?.classList.contains("is-running")).toBe(true);
    expect(items[0].querySelector(".memory-list-item-snippet")?.textContent).toBe("<svg onload=alert(1)>progress</svg>");
    expect(items[0].querySelectorAll(".memory-list-item-meta")).toHaveLength(2);

    expect(items[1].querySelector(".memory-badge:not(.subtask-status-badge)")?.textContent).toContain("archived");
    expect(items[1].querySelector(".subtask-status-badge")?.classList.contains("is-timeout")).toBe(true);
    expect(items[1].querySelector(".memory-list-item-snippet")?.textContent).toBe("<script>summary</script>");
    expect(items[2].querySelector(".memory-list-item-snippet")?.textContent).toContain("No summary yet");
    expect(list.querySelector("script, svg, img, b, mark, time, [onerror], [onload]")).toBeNull();

    items[1].click();
    expect(subtasksState.selectedId).toBe("task-archived");
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "subtask.get",
      params: { taskId: "task-archived" },
    }));
    await Promise.resolve();

    subtasksState.conversationId = "conversation-filter";
    expect(() => feature.renderSubtaskList([subtasksState.items[0]])).not.toThrow();
    expect(list.querySelectorAll(".subtask-list-item")).toHaveLength(1);
    expect(list.querySelector(".memory-badge-shared")).toBeNull();
  });

  it("treats a missing list panel as a no-op", () => {
    const subtasksState = { items: [], selectedId: null, includeArchived: false };
    const { feature } = createFeature(null, subtasksState);

    expect(() => feature.renderSubtaskList([{ id: "task-1", status: "running" }])).not.toThrow();
  });
});
