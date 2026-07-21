// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDetailTaskDetailView } from "./memory-detail-task-detail-view.js";

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
      if (value) throw new Error("Task detail owner must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createView() {
  return createMemoryDetailTaskDetailView({
    t: (_key, params, fallback) => Object.entries(params || {}).reduce(
      (text, [key, value]) => text.replace(`{${key}}`, String(value)),
      fallback ?? "",
    ),
    formatDateTime: (value) => `time:${value || "-"}`,
    formatDuration: (value) => `duration:${value || 0}`,
    formatCount: (value) => `count:${value || 0}`,
    formatUsageVia: (value) => `via:${value || "manual"}`,
  });
}

function createTask() {
  return {
    id: "task-<img src=x onerror=alert(1)>",
    conversationId: "conversation-<script>alert(2)</script>",
    status: "success<svg onload=alert(3)>",
    source: "chat<iframe srcdoc='<script>alert(4)</script>'>",
    agentId: "agent-<object data=javascript:alert(5)>",
    title: "Task <math><mtext>unsafe</mtext></math>",
    objective: "Objective <img src=x onerror=alert(6)>",
    summary: "Summary <script>alert(7)</script>",
    outcome: "Outcome <svg onload=alert(8)>",
    reflection: "Reflection <iframe srcdoc='<script>alert(9)</script>'>",
    startedAt: "2026-07-21T10:00:00.000Z",
    finishedAt: "2026-07-21T10:01:00.000Z",
    durationMs: 60_000,
    tokenTotal: 42,
    workRecap: {
      headline: "Recap <object>unsafe</object>",
      confirmedFacts: ["Fact <img src=x onerror=alert(10)>"],
      pendingActions: ["Next <script>alert(11)</script>"],
      blockers: ["Blocker <svg onload=alert(12)>"],
    },
    resumeContext: {
      currentStopPoint: "Stop <iframe srcdoc='<script>alert(13)</script>'>",
      nextStep: "Next <object>unsafe</object>",
      blockers: ["Resume blocker <math>unsafe</math>"],
    },
    activities: [{
      state: "completed",
      kind: "edit",
      happenedAt: "2026-07-21T10:00:30.000Z",
      title: "Activity <img src=x onerror=alert(14)>",
      summary: "Activity summary <script>alert(15)</script>",
      files: ["src/<svg onload=alert(16)>.js"],
      artifactPaths: ["artifacts/<iframe>.md"],
      memoryChunkIds: ["memory-<object>1</object>"],
      error: "Error <math>unsafe</math>",
    }],
    usedMethods: [{
      usageId: "usage-<img src=x onerror=alert(17)>",
      taskId: "task-source",
      assetKey: "method-<script>alert(18)</script>",
      usedVia: "tool",
      usageCount: 2,
      createdAt: "2026-07-21T10:00:00.000Z",
      sourceCandidateId: "candidate-method",
      sourceCandidateTaskId: "task-method",
      sourceCandidatePublishedPath: "methods/<svg>.md",
      lastUsedTaskId: "task-latest",
    }],
    usedSkills: [{
      usageId: "usage-skill",
      taskId: "task-source",
      assetKey: "skill-demo",
      usedVia: "search",
      usageCount: 1,
      skillFreshness: {
        status: "needs_patch",
        summary: "Freshness <img src=x onerror=alert(19)>",
        sourceCandidateId: "candidate-skill",
        skillKey: "skill-demo",
        signals: [{ summary: "Signal <script>alert(20)</script>" }],
        suggestion: {
          kind: "review_patch_candidate",
          summary: "Patch <svg onload=alert(21)>",
          candidateId: "candidate-patch",
        },
      },
    }],
    toolCalls: [{
      toolName: "tool-<iframe>",
      success: false,
      durationMs: 12,
      note: "Note <object>unsafe</object>",
    }],
    memoryLinks: [{
      relation: "used",
      memoryType: "fact",
      chunkId: "memory-1",
      sourcePath: "memory/<math>.md",
      snippet: "Snippet <img src=x onerror=alert(22)>",
      sourceView: { scope: "shared" },
    }],
    artifactPaths: ["output/<script>.md"],
  };
}

describe("Memory detail Task DOM owner", () => {
  it("renders full Task content and actions without parsing dynamic HTML", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const candidatePanel = document.createElement("div");
    candidatePanel.className = "candidate-panel";
    candidatePanel.textContent = "Candidate <img src=x onerror=alert(23)>";
    const task = createTask();

    expect(() => createView().render({
      container,
      task,
      candidatePanel,
      goalId: "goal-<script>1</script>",
      goalDisplayName: "Goal <svg onload=alert(24)>",
      contextTargets: {
        memoryCount: 1,
        candidateCount: 1,
        artifactCount: 1,
        firstMemoryId: "memory-1",
        firstCandidateId: "candidate-1",
        firstArtifactPath: "artifact/<iframe>.md",
      },
      sourceExplanationItems: [{
        label: "Recap <img src=x onerror=alert(25)>",
        previews: ["Preview <script>alert(26)</script>"],
        activityReference: {
          badgeLabel: "Activities 1",
          title: "Activity IDs: activity-<svg onload=alert(27)>",
        },
      }],
      sourceExplanationUpdatedAt: "time:2026-07-21",
      hasLoadedSourceExplanation: true,
      pendingActionKey: "",
      pendingUsageRevokeId: "",
      selectedCandidate: { id: "candidate-current", taskId: "task-source" },
      lastUsageAt: "2026-07-21T10:00:00.000Z",
      compact: false,
    })).not.toThrow();

    expect(container.textContent).toContain(task.title);
    expect(container.textContent).toContain(task.workRecap.headline);
    expect(container.textContent).toContain("Activity / Worklog (1)");
    expect(container.querySelector(".candidate-panel")?.textContent).toContain("Candidate <img");
    expect(container.querySelector("[data-open-memory-id='memory-1']")).toBeTruthy();
    expect(container.querySelector("[data-open-candidate-id='candidate-1']")).toBeTruthy();
    expect(container.querySelector("[data-open-experience-candidate-id='candidate-1']")).toBeTruthy();
    expect(container.querySelector("[data-open-source='artifact/<iframe>.md']")).toBeTruthy();
    expect(container.querySelector("[data-revoke-usage-id]")?.getAttribute("data-revoke-usage-id"))
      .toBe(task.usedMethods[0].usageId);
    expect(container.querySelector("[data-load-task-source-explanation]")?.getAttribute("data-load-task-source-explanation"))
      .toBe(task.id);
    expect(container.querySelector("[title]")?.getAttribute("title"))
      .toContain("activity-<svg onload=alert(27)>");
    expect(container.querySelector("img, script, svg, iframe, object, math, [onerror], [onload], [srcdoc]"))
      .toBeNull();
  });

  it("replaces full content with compact Task content and tolerates missing roots", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const view = createView();
    const task = createTask();
    const candidatePanel = document.createElement("div");
    candidatePanel.textContent = "Candidate panel";

    view.render({ container, task, candidatePanel, contextTargets: {}, compact: false });
    const previousShell = container.firstElementChild;
    view.render({
      container,
      task: { ...task, title: "Compact replacement" },
      candidatePanel: document.createElement("div"),
      contextTargets: {},
      compact: true,
    });

    expect(previousShell?.isConnected).toBe(false);
    expect(container.textContent).toContain("Compact replacement");
    expect(container.textContent).not.toContain("Candidate panel");
    expect(container.textContent).not.toContain("Work Recap");
    expect(container.textContent).not.toContain("Activity / Worklog");
    expect(container.textContent).toContain(task.objective);
    expect(() => view.render({ container: null, task })).not.toThrow();
  });
});
