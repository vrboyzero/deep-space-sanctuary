// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createExperienceWorkbenchCapabilityOverviewView } from "./experience-workbench-capability-overview-view.js";

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
      if (value) throw new Error("Experience Workbench capability overview must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Experience Workbench Capability Overview DOM owner", () => {
  it("renders capability actions and untrusted values without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createExperienceWorkbenchCapabilityOverviewView();
    const candidateId = 'draft-1"><img src=x onerror=alert(1)>';
    const taskId = 'task-1"><svg onload=alert(2)>';
    const assetPath = 'methods/demo"><iframe srcdoc=alert(3)>.md';

    expect(() => view.render({
      container,
      title: "<script>Capability</script>",
      caption: "<mark>Draft candidates</mark>",
      resynthesize: {
        assetPath,
        placeholder: "<b>Paste a path</b>",
        previewLabel: "<em>Preview</em>",
        previewDisabled: false,
        fillSelectedLabel: "<strong>Fill selected</strong>",
        fillSelectedDisabled: true,
        fillSelectedTitle: '<img src=x onerror=alert(4)>',
      },
      lanes: [{
        type: "method",
        title: "<i>Method Draft</i>",
        countLabel: "<u>Draft 1</u>",
        bulkRejectLabel: "<button>Reject all</button>",
        bulkRejectDisabled: false,
        emptyLabel: "<span>empty</span>",
        items: [{
          candidateId,
          title: "<script>Draft method</script>",
          candidateIdLabel: `ID · ${candidateId}`,
          statusLabel: "<svg onload=alert(5)>draft</svg>",
          taskId,
          taskLabel: `Task ${taskId}`,
          skillFreshnessStatus: "<a href=javascript:alert(6)>fresh</a>",
          updatedAtLabel: "<time>today</time>",
          typeLabel: "<iframe srcdoc=alert(7)>method</iframe>",
          synthesized: true,
          synthesizedLabel: "<img src=x onerror=alert(8)>synthesized",
          skillFreshnessSummary: "<object data=javascript:alert(9)>summary</object>",
          summary: "<details open>summary</details>",
          openCandidateLabel: "<q>Open candidate</q>",
          openTaskLabel: "<q>Open task</q>",
          synthesizeLabel: "<q>Synthesize</q>",
          synthesizeDisabled: false,
          acceptLabel: "<q>Accept</q>",
          acceptDisabled: true,
          rejectLabel: "<q>Reject</q>",
          rejectDisabled: false,
        }],
      }, {
        type: "skill",
        title: "Skill Draft",
        countLabel: "Draft 0",
        bulkRejectLabel: "Reject all",
        bulkRejectDisabled: true,
        emptyLabel: "No draft candidates",
        items: [],
      }],
    })).not.toThrow();

    const root = container.firstElementChild;
    const input = root?.querySelector("[data-experience-resynthesize-asset-path]");
    const preview = root?.querySelector("[data-experience-resynthesize-preview]");
    const fillSelected = root?.querySelector("[data-experience-resynthesize-fill-selected]");
    const methodLane = root?.querySelectorAll(".memory-usage-overview-lane")[0];
    const skillLane = root?.querySelectorAll(".memory-usage-overview-lane")[1];
    const row = methodLane?.querySelector(".experience-capability-row");

    expect(root?.className).toBe("memory-stat-card memory-stat-card-wide memory-usage-overview-card experience-capability-card");
    expect(input?.value).toBe(assetPath);
    expect(input?.placeholder).toBe("<b>Paste a path</b>");
    expect(preview?.disabled).toBe(false);
    expect(fillSelected?.disabled).toBe(true);
    expect(fillSelected?.title).toBe('<img src=x onerror=alert(4)>');
    expect(methodLane?.querySelector("[data-capability-bulk-reject-type]")?.getAttribute("data-capability-bulk-reject-type")).toBe("method");
    expect(skillLane?.querySelector(".memory-usage-overview-empty")?.textContent).toBe("No draft candidates");
    expect(row?.className).toBe("memory-usage-overview-row experience-capability-row experience-candidate-synthesized");
    expect(row?.querySelector("[data-capability-open-candidate-id]")?.getAttribute("data-capability-open-candidate-id")).toBe(candidateId);
    expect(row?.querySelector("[data-capability-open-task-id]")?.getAttribute("data-capability-open-task-id")).toBe(taskId);
    expect(row?.querySelector("[data-capability-review-candidate-action='accept']")?.disabled).toBe(true);
    expect(row?.querySelector("[data-capability-synthesize-candidate-id]")?.disabled).toBe(false);
    expect(root?.textContent).toContain("<details open>summary</details>");
    expect(root?.querySelector("img, script, mark, i, u, button > button, svg, iframe, a, object, details, [onerror], [onload]")).toBeNull();
  });

  it("renders the owner before existing capability action listener assembly", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/experience-workbench.js"),
      "utf8",
    );
    const panelStart = source.indexOf("function renderExperienceWorkbenchCapabilityOverviewPanel()");
    const panelEnd = source.indexOf("function renderExperienceWorkbenchPublishedAssetLane(", panelStart);
    const panelSource = source.slice(panelStart, panelEnd);
    const renderIndex = panelSource.indexOf("capabilityOverviewView.render({");
    const bindIndex = panelSource.indexOf("bindExperienceWorkbenchCapabilityActions();");

    expect(source).toContain('import { createExperienceWorkbenchCapabilityOverviewView }');
    expect(source).toContain("const capabilityOverviewView = createExperienceWorkbenchCapabilityOverviewView();");
    expect(panelSource).not.toContain("experienceWorkbenchCapabilityOverviewEl.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
  });

  it("replaces prior content and tolerates empty lanes or a missing root", () => {
    const container = document.createElement("div");
    const view = createExperienceWorkbenchCapabilityOverviewView();

    view.render({
      container,
      title: "Capability",
      caption: "Draft candidates",
      resynthesize: {},
      lanes: [{
        type: "method",
        title: "Method Draft",
        countLabel: "Draft 1",
        bulkRejectLabel: "Reject all",
        bulkRejectDisabled: false,
        emptyLabel: "No draft candidates",
        items: [{
          candidateId: "draft-1",
          title: "First draft",
          statusLabel: "draft",
          updatedAtLabel: "today",
          typeLabel: "method",
          summary: "first summary",
          openCandidateLabel: "Open candidate",
          synthesizeLabel: "Synthesize",
          acceptLabel: "Accept",
          rejectLabel: "Reject",
        }],
      }],
    });
    const firstCard = container.firstElementChild;

    view.render({
      container,
      title: "Capability",
      caption: "No candidates",
      resynthesize: {},
      lanes: [{
        type: "method",
        title: "Method Draft",
        countLabel: "Draft 0",
        bulkRejectLabel: "Reject all",
        bulkRejectDisabled: true,
        emptyLabel: "No draft candidates",
        items: [],
      }],
    });

    expect(firstCard?.isConnected).toBe(false);
    expect(container.querySelector(".memory-usage-overview-empty")?.textContent).toBe("No draft candidates");
    expect(container.querySelector(".experience-capability-row")).toBeNull();
    expect(() => view.render({ container: null, resynthesize: {}, lanes: [] })).not.toThrow();
  });
});
