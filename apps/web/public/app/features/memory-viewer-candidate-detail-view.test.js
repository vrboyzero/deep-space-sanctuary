// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerCandidateDetailView } from "./memory-viewer-candidate-detail-view.js";

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
      if (value) throw new Error("Candidate detail must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer candidate detail DOM owner", () => {
  it("renders a draft candidate and its context as inert text without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerCandidateDetailView({
      t: (_key, _params, fallback) => `<img src=x onerror=alert(1)>${fallback ?? ""}`,
      formatTaskStatusLabel: (value) => `<script>${value}</script>`,
      formatTaskSourceLabel: (value) => `<svg onload=alert(2)>${value}</svg>`,
      formatMemoryTypeLabel: (value) => `<iframe>${value}</iframe>`,
      formatDateTime: (value) => `<object>${value}</object>`,
      formatDuration: (value) => `<math>${value}</math>`,
      summarizeSourcePath: (value) => `<a href=javascript:alert(3)>${value}</a>`,
    });
    const candidate = {
      id: "candidate-<img src=x onerror=alert(4)>",
      taskId: "task-<script>alert(5)</script>",
      type: "method-<svg onload=alert(6)>",
      status: "draft",
      title: "Candidate <iframe srcdoc='<script>alert(7)</script>'>",
      slug: "slug-<object data=javascript:alert(8)>",
      publishedPath: "state/<a href=javascript:alert(9)>method.md",
      summary: "Summary <math><mtext>unsafe</mtext></math>",
      content: "# Content <img src=x onerror=alert(10)>",
      sourceView: {
        scope: "shared",
        summary: "<script>alert(11)</script>shared source",
      },
      sourceTaskSnapshot: {
        conversationId: "conversation-<img src=x onerror=alert(12)>",
        status: "completed",
        source: "agent",
        startedAt: "2026-07-21T12:00:00.000Z",
        objective: "Objective <svg onload=alert(13)>",
        summary: "Snapshot <iframe srcdoc='<script>alert(14)</script>'>",
        memoryLinks: [{
          chunkId: "memory-<img src=x onerror=alert(15)>",
          relation: "used-<script>alert(16)</script>",
          memoryType: "daily",
          sourcePath: "memory/<svg onload=alert(17)>.md",
          snippet: "Snippet <object data=javascript:alert(18)>",
        }],
        artifactPaths: ["artifact/<script>alert(19)</script>.md"],
        toolCalls: [{
          toolName: "tool-<img src=x onerror=alert(20)>",
          success: true,
          durationMs: 12,
          note: "Note <svg onload=alert(21)>",
        }],
      },
    };

    expect(() => view.render({
      container,
      candidate,
      contextTargets: {
        sourceTaskId: candidate.taskId,
        sourceConversationId: candidate.sourceTaskSnapshot.conversationId,
        firstMemoryId: candidate.sourceTaskSnapshot.memoryLinks[0].chunkId,
        memoryCount: 1,
        firstArtifactPath: candidate.sourceTaskSnapshot.artifactPaths[0],
        artifactCount: 1,
        publishedPath: candidate.publishedPath,
      },
      pendingActionKey: `candidate:${candidate.id}:accept`,
      compact: false,
    })).not.toThrow();

    expect(container.querySelector(":scope > .memory-detail-shell > .memory-detail-card")).toBeTruthy();
    expect(container.querySelector(".memory-detail-text strong")?.textContent).toBe(candidate.title);
    expect(container.querySelector("[data-open-experience-candidate-id]")?.getAttribute("data-open-experience-candidate-id"))
      .toBe(candidate.id);
    expect(container.querySelector("[data-open-task-id]")?.getAttribute("data-open-task-id"))
      .toBe(candidate.taskId);
    expect(container.querySelector("[data-open-memory-id]")?.getAttribute("data-open-memory-id"))
      .toBe(candidate.sourceTaskSnapshot.memoryLinks[0].chunkId);
    expect(container.querySelector("[data-open-source]")?.getAttribute("data-open-source"))
      .toBe(candidate.sourceTaskSnapshot.artifactPaths[0]);
    expect(container.querySelector("[data-review-candidate-action='accept']")?.disabled).toBe(true);
    expect(container.querySelector("[data-review-candidate-action='reject']")?.disabled).toBe(false);
    expect(container.querySelector(".memory-detail-pre")?.textContent).toBe(candidate.content);
    expect(container.textContent).toContain(candidate.summary);
    expect(container.textContent).toContain(candidate.sourceTaskSnapshot.objective);
    expect(container.textContent).toContain(candidate.sourceTaskSnapshot.memoryLinks[0].snippet);
    expect(container.textContent).toContain(candidate.sourceTaskSnapshot.toolCalls[0].note);
    expect(container.querySelector("img, script, svg, iframe, object, math, a, [onerror], [onload], [srcdoc]"))
      .toBeNull();
  });

  it("preserves optional freshness and learning sections while compact mode replaces them", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const view = createMemoryViewerCandidateDetailView();
    const candidate = {
      id: "candidate-skill-1",
      taskId: "task-skill-1",
      type: "skill",
      status: "draft",
      title: "Skill candidate",
      sourceTaskSnapshot: {},
      memoryFreshness: {
        summary: {
          available: true,
          headline: "<img src=x onerror=alert(30)>Needs memory review",
          reviewRequiredCount: 2,
          staleCount: 1,
          supersededCount: 3,
        },
      },
      skillFreshness: {
        status: "needs_patch",
        manualStaleMark: true,
        sourceCandidateId: "source-skill-1",
        skillKey: "skill-key-1",
        summary: "<script>alert(31)</script>Needs patch",
        signals: [
          { summary: "signal-1" },
          { summary: "signal-2" },
          { summary: "signal-3" },
          { summary: "signal-hidden" },
        ],
        suggestion: {
          kind: "review_patch_candidate",
          candidateId: "patch-candidate-1",
          summary: "<svg onload=alert(32)>Review patch candidate",
        },
      },
      learningReviewInput: {
        summary: { headline: "<iframe>Learning headline</iframe>" },
        summaryLines: ["summary-1", "summary-2", "summary-3", "summary-4", "summary-hidden"],
        nudges: ["nudge-1", "nudge-2", "nudge-3", "nudge-4", "nudge-hidden"],
      },
      content: "Candidate content",
    };

    view.render({
      container,
      candidate,
      pendingActionKey: "skill-freshness:source-skill-1:active",
      compact: false,
    });

    const previousPanel = container.querySelector(":scope > .memory-detail-shell > .memory-detail-card");
    expect(container.querySelector(".memory-candidate-memory-freshness")?.textContent)
      .toContain(candidate.memoryFreshness.summary.headline);
    expect(container.querySelector(".memory-candidate-memory-freshness")?.textContent)
      .toContain("review_required=2 / stale=1 / superseded=3");
    expect(container.querySelector(".memory-candidate-skill-freshness")?.textContent)
      .toContain(candidate.skillFreshness.summary);
    expect(container.querySelectorAll(".memory-candidate-skill-signal")).toHaveLength(3);
    expect(container.textContent).not.toContain("signal-hidden");
    const staleButton = container.querySelector("[data-skill-freshness-stale-action='clear']");
    expect(staleButton?.getAttribute("data-skill-freshness-source-candidate-id")).toBe("source-skill-1");
    expect(staleButton?.getAttribute("data-skill-freshness-skill-key")).toBe("skill-key-1");
    expect(staleButton?.disabled).toBe(true);
    expect(container.querySelector("[data-open-candidate-id='patch-candidate-1']")).toBeTruthy();
    expect(container.querySelectorAll(".memory-candidate-learning-summary")).toHaveLength(4);
    expect(container.querySelectorAll(".memory-candidate-learning-nudge")).toHaveLength(4);
    expect(container.textContent).not.toContain("summary-hidden");
    expect(container.textContent).not.toContain("nudge-hidden");
    expect(container.querySelector("img, script, svg, iframe, [onerror], [onload]")).toBeNull();

    view.render({ container, candidate, compact: true });

    expect(previousPanel?.isConnected).toBe(false);
    expect(container.querySelector(".memory-candidate-memory-freshness")).toBeNull();
    expect(container.querySelector(".memory-candidate-skill-freshness")).toBeNull();
    expect(container.querySelector(".memory-candidate-learning-review")).toBeNull();
    expect(container.textContent).toContain(candidate.title);
    expect(() => view.render({ container: null, candidate })).not.toThrow();
  });
});
