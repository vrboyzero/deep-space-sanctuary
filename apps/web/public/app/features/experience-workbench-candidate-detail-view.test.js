// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createExperienceWorkbenchCandidateDetailView } from "./experience-workbench-candidate-detail-view.js";
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
      if (value) throw new Error("Experience candidate detail must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createCandidatePanel(candidate) {
  return createMemoryViewerCandidateDetailView().createPanel({
    ownerDocument: document,
    candidate,
    contextTargets: {
      sourceTaskId: candidate.taskId,
      publishedPath: candidate.publishedPath,
    },
    compact: false,
  });
}

describe("Experience Workbench candidate detail DOM owner", () => {
  it("composes aggregate and Candidate owners without parsing dynamic HTML", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createExperienceWorkbenchCandidateDetailView();
    const candidate = {
      id: "candidate-<img src=x onerror=alert(1)>",
      taskId: "task-<script>alert(2)</script>",
      type: "method",
      status: "draft",
      title: "Candidate <svg onload=alert(3)>",
      publishedPath: "state/<iframe srcdoc='<script>alert(4)</script>'>.md",
      content: "<object data=javascript:alert(5)>content",
      sourceTaskSnapshot: {},
    };
    const aggregate = {
      title: "Aggregate <img src=x onerror=alert(6)>",
      summary: "Summary <script>alert(7)</script>",
      badges: [
        { text: "Method <svg onload=alert(8)>", className: "memory-badge" },
        { text: "Published", className: "memory-badge memory-badge-shared" },
      ],
      freshness: {
        headline: "Freshness <iframe srcdoc='<script>alert(9)</script>'>",
        counts: "review_required=1 / stale=0 / superseded=0",
      },
      cards: [
        {
          label: "Task",
          text: candidate.taskId,
          action: { attribute: "data-open-task-id", value: candidate.taskId },
        },
        { label: "Slug", text: "slug-<math><mtext>unsafe</mtext></math>" },
        {
          label: "Published",
          text: "method.md",
          action: { attribute: "data-open-source", value: candidate.publishedPath },
        },
        {
          label: "Consumed",
          text: "Consumed by <object>candidate-2</object>",
          action: { attribute: "data-open-candidate-id", value: "candidate-<script>2</script>" },
        },
      ],
      actions: [
        {
          text: "Open source task",
          attribute: "data-open-task-id",
          value: candidate.taskId,
        },
        {
          text: "Open methods",
          attribute: "data-open-tool-settings-tab",
          value: "methods",
        },
      ],
    };

    expect(() => view.render({
      container,
      aggregate,
      candidatePanel: createCandidatePanel(candidate),
    })).not.toThrow();

    const panels = container.querySelectorAll(":scope > .memory-detail-shell > .memory-detail-card");
    expect(panels).toHaveLength(2);
    expect(panels[0].querySelector(".goal-summary-title")?.textContent).toBe(aggregate.title);
    expect(panels[1].querySelector(".memory-detail-text strong")?.textContent).toBe(candidate.title);
    expect(container.querySelector("[data-open-task-id]")?.getAttribute("data-open-task-id")).toBe(candidate.taskId);
    expect(container.querySelector("[data-open-source]")?.getAttribute("data-open-source")).toBe(candidate.publishedPath);
    expect(container.querySelector("[data-open-candidate-id]")?.getAttribute("data-open-candidate-id"))
      .toBe("candidate-<script>2</script>");
    expect(container.querySelector("[data-open-tool-settings-tab]")?.getAttribute("data-open-tool-settings-tab"))
      .toBe("methods");
    expect(container.querySelector(".memory-candidate-memory-freshness")?.textContent)
      .toContain(aggregate.freshness.headline);
    expect(container.querySelector("img, script, svg, iframe, object, math, [onerror], [onload], [srcdoc]"))
      .toBeNull();
  });

  it("replaces full detail with compact input and tolerates missing roots", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const view = createExperienceWorkbenchCandidateDetailView();
    const candidate = {
      id: "candidate-1",
      taskId: "task-1",
      type: "skill",
      status: "accepted",
      title: "Skill candidate",
      sourceTaskSnapshot: {},
    };

    view.render({
      container,
      aggregate: {
        title: "Full aggregate",
        summary: "Full summary",
        badges: [],
        freshness: { headline: "Needs review", counts: "review_required=1 / stale=0 / superseded=0" },
        cards: [{ label: "Full only", text: "full-value" }],
        actions: [],
      },
      candidatePanel: createCandidatePanel(candidate),
    });
    const previousShell = container.firstElementChild;

    view.render({
      container,
      aggregate: {
        title: "Compact aggregate",
        summary: "Compact summary",
        badges: [],
        freshness: null,
        cards: [{ label: "Compact", text: "compact-value" }],
        actions: [],
      },
      candidatePanel: createMemoryViewerCandidateDetailView().createPanel({
        ownerDocument: document,
        candidate,
        compact: true,
      }),
    });

    expect(previousShell?.isConnected).toBe(false);
    expect(container.textContent).toContain("Compact aggregate");
    expect(container.textContent).toContain("compact-value");
    expect(container.textContent).not.toContain("Full aggregate");
    expect(container.querySelector(".memory-candidate-memory-freshness")).toBeNull();
    expect(() => view.render({ container: null, aggregate: {}, candidatePanel: null })).not.toThrow();
  });

  it("projects synthesized and consumed cards only in full mode", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const t = (_key, params, fallback) => Object.entries(params || {}).reduce(
      (text, [key, value]) => text.replace(`{${key}}`, String(value)),
      fallback ?? "",
    );
    const view = createExperienceWorkbenchCandidateDetailView({
      t,
      formatDateTime: (value) => `time:${value || "-"}`,
      formatCandidateTypeLabel: () => "Skill",
      formatCandidateStatusLabel: () => "Draft",
      extractCandidateContextTargets: () => ({
        sourceTaskId: "task-source-1",
        publishedPath: "state/skills/demo.md",
        memoryCount: 2,
        artifactCount: 3,
      }),
      resolveExperienceDisplayTaskId: () => "task-display-1",
      summarizePathLabel: () => "demo.md",
      isSynthesizedCandidate: () => true,
      getSynthesisSourceCount: () => 2,
      getSynthesisConsumedInfo: () => ({
        consumedByCandidateId: "candidate-next",
        consumedAt: "2026-07-21T12:00:00.000Z",
      }),
    });
    const candidate = {
      id: "candidate-synthesized",
      type: "skill",
      status: "draft",
      slug: "demo",
      publishedPath: "state/skills/demo.md",
      updatedAt: "2026-07-21T11:00:00.000Z",
      sourceTaskSnapshot: { memoryLinks: [], artifactPaths: [], toolCalls: [] },
    };

    view.render({
      container,
      candidate,
      compact: false,
      candidatePanel: createCandidatePanel(candidate),
    });
    expect(container.textContent).toContain("草稿来源");
    expect(container.textContent).toContain("合成稿 · 2");
    expect(container.textContent).toContain("合成来源数");
    expect(container.textContent).toContain("已被合成稿 candidate-next 消化");
    expect(container.querySelector("[data-open-candidate-id='candidate-next']")).toBeTruthy();
    expect(container.querySelector("[data-open-tool-settings-tab='skills']")).toBeTruthy();

    view.render({
      container,
      candidate,
      compact: true,
      candidatePanel: createCandidatePanel(candidate),
    });
    expect(container.textContent).not.toContain("草稿来源");
    expect(container.textContent).not.toContain("合成来源数");
    expect(container.textContent).not.toContain("candidate-next");
    expect(container.querySelector("[data-open-candidate-id='candidate-next']")).toBeNull();
  });
});
