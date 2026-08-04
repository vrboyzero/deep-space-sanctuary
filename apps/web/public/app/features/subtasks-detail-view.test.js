// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSubtasksDetailView,
  formatSubtaskStatus,
  getStatusToneClass,
} from "./subtasks-detail-view.js";

afterEach(() => {
  document.body.replaceChildren();
});

it("renders restart-lost subtasks as interrupted and resumable", () => {
  expect(formatSubtaskStatus("interrupted")).toBe("运行已中断");
  expect(getStatusToneClass("interrupted")).toBe("is-timeout");

  const detail = document.createElement("div");
  const model = createFullModel();
  createView(detail).render(createFullModel({
    item: {
      ...model.item,
      status: "interrupted",
      recovery: {
        state: "runtime_lost",
        previousStatus: "running",
        mutationReplay: "forbidden",
      },
    },
    pendingActionKind: "",
  }));

  expect(detail.querySelector("[data-subtask-stop]")).toBeNull();
  expect(detail.querySelector("[data-subtask-resume-input]")).not.toBeNull();
  expect(detail.querySelector("[data-subtask-resume-send]")?.disabled).toBe(false);
});

function blockNonEmptyInnerHtml(element) {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("SubTasks detail must not use innerHTML");
      descriptor.set.call(this, value);
    },
  });
}

function createView(detail) {
  return createSubtasksDetailView({
    refs: { subtasksDetailEl: detail },
    formatDateTime: (value) => `<time>${String(value ?? "")}</time>`,
    summarizeSourcePath: (value) => `<img src=x onerror=alert(1)>${String(value ?? "")}`,
    t: (key, _params, fallback) => `<mark data-key="${key}">${fallback ?? key}</mark>`,
  });
}

function createFullModel(overrides = {}) {
  const taskId = 'task"><img src=x onerror="alert(1)">';
  const sessionId = 'session"><svg onload="alert(2)">';
  return {
    item: {
      id: taskId,
      sessionId,
      kind: '<iframe srcdoc="alert(3)">',
      status: "running",
      agentId: "<b>agent</b>",
      parentConversationId: "goal:goal-1",
      createdAt: "created",
      updatedAt: "updated",
      instruction: "<script>alert(4)</script>",
      summary: "<img src=x onerror=alert(5)>",
      progress: { message: "<svg onload=alert(6)>" },
      outputPath: 'C:\\output"><img>',
      outputPreview: "<button onclick=alert(7)>output</button>",
      notifications: [{
        kind: "failed",
        createdAt: "notification-time",
        message: "<iframe srcdoc=alert(8)>",
      }],
      steering: [{
        status: "failed",
        requestedAt: "steering-time",
        message: "<script>alert(9)</script>",
        error: "<img src=x onerror=alert(10)>",
      }],
      resume: [{
        status: "delivered",
        requestedAt: "resume-time",
        message: "<svg onload=alert(11)>",
        resumedFromSessionId: "old-session",
      }],
      takeover: [{
        status: "failed",
        requestedAt: "takeover-time",
        agentId: "<b>old-agent</b>",
        message: "<iframe srcdoc=alert(12)>",
        mode: "safe_point",
      }],
      scratchPath: "scratch.md",
      reviewPath: "review.md",
      lessonPath: "lesson.md",
      error: "<script>alert(13)</script>",
      archiveReason: "<img src=x onerror=alert(14)>",
      launchSpec: {
        profileId: "profile",
        channel: "web",
        timeoutMs: 1000,
        background: true,
        permissionMode: "confirm",
        isolationMode: "worktree",
        role: "coder",
        policySummary: "policy",
        parentTaskId: "parent-task",
        cwd: "C:/repo",
        resolvedCwd: "C:/repo",
        worktreeStatus: "created",
        worktreePath: "C:/worktree",
        worktreeRepoRoot: "C:/repo",
        worktreeBranch: "feature/detail",
        toolSet: ["read", "write"],
        allowedToolFamilies: ["workspace-read"],
        maxToolRiskLevel: "medium",
        contextKeys: ["taskId"],
        worktreeError: "<img src=x onerror=alert(15)>",
        delegation: {
          source: "delegate",
          intentKind: "ad_hoc",
          intentSummary: "<script>alert(16)</script>",
          expectedDeliverableFormat: "patch",
          expectedDeliverableSummary: "summary",
          aggregationMode: "single",
          sourceAgentIds: ["manager"],
          contextKeys: ["taskId"],
          ownership: { scopeSummary: "scope", outOfScope: ["none"], writeScope: ["src"] },
          acceptance: { doneDefinition: "done", verificationHints: ["test"] },
          deliverableContract: { requiredSections: ["result"] },
        },
      },
    },
    outputContent: "<svg onload=alert(17)>output",
    pendingActionKind: "steering",
    resultEnvelope: {
      status: "done",
      agentId: "result-agent",
      finishedAt: "result-time",
      outputPath: "result.md",
      summary: "result summary",
    },
    launchExplainability: {
      effectiveLaunch: { source: "runtime", agentId: "agent" },
    },
    promptSnapshotView: null,
    scratchText: "<script>alert(18)</script>",
    reviewText: "review",
    lessonText: "lesson",
    acceptanceGate: {
      status: "pending",
      doneDefinitionCheck: "pending",
      requiredSections: ["result"],
      missingRequiredSections: ["verification"],
      summary: "gate summary",
      reasons: ["reason"],
    },
    teamSharedState: {
      teamId: "team-1",
      mode: "parallel_subtasks",
      roster: [{ laneId: "lane-1", laneState: "accepted", taskId: "lane-task", agentId: "lane-agent" }],
      completionGate: { status: "pending", summary: "waiting" },
    },
    continuationState: {
      resumeMode: "resume",
      nextAction: "continue",
      checkpoints: { openCount: 1, blockerCount: 0, labels: ["checkpoint"] },
      progress: { current: "working", recent: ["<img src=x onerror=alert(19)>"] },
      recommendedTargetId: "target-1",
      summary: "continuation",
    },
    steeringDraft: "<img src=x onerror=alert(20)>",
    resumeDraft: "resume draft",
    takeoverDraft: "takeover draft",
    takeoverAgentDraft: "agent-next",
    continuationFocusSessionId: `  ${sessionId}  `,
    ...overrides,
  };
}

describe("SubTasks full detail DOM owner", () => {
  it("renders full and optional detail fields through DOM/text/property/attribute APIs", () => {
    const detail = document.createElement("div");
    document.body.append(detail);
    blockNonEmptyInnerHtml(detail);
    const model = createFullModel();
    const root = createView(detail).render(model);

    expect(root).toBe(detail.firstElementChild);
    expect(root?.className).toBe("memory-detail-shell is-continuation-focus");
    expect(root?.getAttribute("data-subtask-session-focus")).toBe(model.item.sessionId);
    expect(detail.querySelector(".memory-detail-title")?.textContent).toBe(model.item.id);
    expect(detail.querySelector(".subtask-status-badge")?.classList.contains("is-running")).toBe(true);
    expect(detail.querySelector("[data-subtask-stop]")?.getAttribute("data-subtask-stop")).toBe(model.item.id);
    expect(detail.querySelector("[data-open-goal-id]")?.getAttribute("data-open-goal-id")).toBe("goal-1");
    expect(detail.querySelector("[data-open-task-id]")?.getAttribute("data-open-task-id")).toBe("parent-task");
    expect(detail.querySelector("[data-open-source]")?.getAttribute("data-open-source")).toBe("C:/worktree");
    expect(detail.querySelector("[data-continuation-action]")?.getAttribute("data-continuation-action")).toContain("target-1");

    const steeringInput = detail.querySelector("[data-subtask-steering-input]");
    expect(steeringInput?.value).toBe("<img src=x onerror=alert(20)>");
    expect(steeringInput?.placeholder).toContain("Describe how this running subtask");
    expect(steeringInput?.disabled).toBe(true);
    expect(detail.querySelector("[data-subtask-steering-send]")?.disabled).toBe(true);
    expect(detail.querySelector("[data-subtask-resume-input]")).toBeNull();
    expect(detail.querySelector("[data-subtask-takeover-input]")?.value).toBe("takeover draft");
    expect(detail.querySelector("[data-subtask-takeover-agent-input]")?.value).toBe("agent-next");
    expect(detail.querySelector("[data-subtask-takeover-input]")?.placeholder).toContain("safe point");
    expect(detail.querySelector("[data-subtask-takeover-input]")?.disabled).toBe(false);
    expect(detail.querySelector(".memory-detail-pre")?.textContent).toBe("<script>alert(4)</script>");
    expect(detail.textContent).toContain("This subtask session has no persisted prompt snapshot yet.");
    expect(detail.querySelectorAll(".subtask-detail-sections > .memory-detail-card").length).toBeGreaterThan(10);
    expect(detail.querySelector("img, svg, script, iframe, b, mark, time, button[onclick], [onerror], [onload]")).toBeNull();
  });

  it("replaces old content and treats a missing detail root as a no-op", () => {
    const detail = document.createElement("div");
    const view = createView(detail);
    const first = view.render(createFullModel());
    const second = view.render(createFullModel({
      item: { id: "task-second", status: "done", agentId: "agent-second", notifications: [] },
      continuationFocusSessionId: "",
      continuationState: null,
      teamSharedState: null,
      acceptanceGate: null,
      resultEnvelope: null,
      launchExplainability: null,
      scratchText: "",
      reviewText: "",
      lessonText: "",
    }));

    expect(first?.isConnected).toBe(false);
    expect(second).toBe(detail.firstElementChild);
    expect(detail.children).toHaveLength(1);
    expect(detail.querySelector(".memory-detail-title")?.textContent).toBe("task-second");
    expect(detail.querySelector("[data-subtask-stop]")).toBeNull();
    expect(createView(null).render(createFullModel())).toBeNull();
  });

  it("keeps DOM-owner rendering before existing detail action listener assembly", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "apps/web/public/app/features/subtasks-overview.js"), "utf8");
    const detailStart = source.indexOf("function renderSubtaskDetail(item, outputContent = \"\")");
    const detailEnd = source.indexOf("async function loadSubtaskDetail", detailStart);
    const detailSource = source.slice(detailStart, detailEnd);
    const renderIndex = detailSource.indexOf("subtasksDetailView.render({");
    const bindIndex = detailSource.indexOf("bindDetailActions();", renderIndex);

    expect(source).toContain("import { createSubtasksDetailView }");
    expect(source).toContain("const subtasksDetailView = createSubtasksDetailView({");
    expect(detailSource).not.toContain("subtasksDetailEl.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
  });
});
