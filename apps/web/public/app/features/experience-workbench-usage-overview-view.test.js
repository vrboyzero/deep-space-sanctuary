// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createExperienceWorkbenchUsageOverviewView } from "./experience-workbench-usage-overview-view.js";

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
      if (value) throw new Error("Experience Workbench usage overview must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Experience Workbench usage overview DOM owner", () => {
  it("renders usage lanes, trusted selectors, and bounded widths without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createExperienceWorkbenchUsageOverviewView();
    const candidateId = 'candidate"><img src=x onerror=alert(1)>';
    const taskId = 'task"><svg onload=alert(2)>';
    const sourcePath = 'methods"><iframe srcdoc=alert(3)>.md';

    expect(() => view.render({
      container,
      title: "<script>Experience Usage Overview</script>",
      caption: "<mark>Shown by cumulative global usage count</mark>",
      showLanes: true,
      lanes: [{
        tone: "method",
        title: "<img src=x onerror=alert(4)>Hot Methods",
        topLabel: "Top <b>1</b>",
        emptyLabel: "<details>Empty</details>",
        items: [{
          assetKey: "<em>method/demo</em>",
          meta: ["<u>candidate</u>", "<q>Recent now</q>"],
          badges: [{ className: "memory-badge memory-badge-shared", label: "<strong>shared</strong>" }],
          actions: [
            { kind: "candidate", value: candidateId, label: "<i>Candidate</i>" },
            { kind: "task", value: taskId, label: "<i>Recent Task</i>" },
            { kind: "source", value: sourcePath, label: "<i>Open Artifact</i>" },
            { kind: "unknown", value: "ignored", label: "<i>Ignored</i>" },
          ],
          barPercent: 180,
          metrics: "<object data=javascript:alert(5)>8</object>",
        }],
      }, {
        tone: "skill",
        title: "<svg onload=alert(6)>Hot Skills",
        topLabel: "",
        emptyLabel: "<iframe srcdoc=alert(7)>No records</iframe>",
        items: [],
      }],
    })).not.toThrow();

    const lanes = container.querySelectorAll(".memory-usage-overview-lane");
    const buttons = container.querySelectorAll(".memory-usage-action-btn");
    const bar = container.querySelector(".memory-usage-overview-bar-fill");

    expect(container.querySelector(".memory-stat-label")?.textContent).toBe("<script>Experience Usage Overview</script>");
    expect(container.querySelector(".memory-stat-caption")?.textContent).toBe("<mark>Shown by cumulative global usage count</mark>");
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.querySelector(".memory-usage-overview-title")?.textContent).toBe("<img src=x onerror=alert(4)>Hot Methods");
    expect(lanes[0]?.querySelector(".memory-stat-caption")?.textContent).toBe("Top <b>1</b>");
    expect(lanes[1]?.querySelector(".memory-usage-overview-empty")?.textContent).toBe("<iframe srcdoc=alert(7)>No records</iframe>");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.getAttribute("data-open-candidate-id")).toBe(candidateId);
    expect(buttons[1]?.getAttribute("data-open-task-id")).toBe(taskId);
    expect(buttons[2]?.getAttribute("data-open-source")).toBe(sourcePath);
    expect(bar?.className).toBe("memory-usage-overview-bar-fill memory-usage-overview-bar-method");
    expect(bar?.style.width).toBe("100%");
    expect(container.textContent).toContain("<object data=javascript:alert(5)>8</object>");
    expect(container.querySelector("img, script, mark, b, details, em, u, q, strong, i, svg, iframe, object, [onerror], [onload]")).toBeNull();
  });

  it("replaces old content and accepts an empty overview or missing root", () => {
    const container = document.createElement("div");
    const view = createExperienceWorkbenchUsageOverviewView();
    view.render({
      container,
      title: "Usage",
      caption: "Caption",
      showLanes: true,
      lanes: [{ tone: "method", title: "Methods", topLabel: "", emptyLabel: "None", items: [] }],
    });
    const firstCard = container.firstElementChild;

    view.render({ container, title: "Usage", caption: "Empty", showLanes: false, lanes: [] });

    expect(firstCard?.isConnected).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(container.querySelector(".memory-usage-overview-grid")).toBeNull();
    expect(() => view.render({ container: null, title: "Ignored", caption: "Ignored", showLanes: true })).not.toThrow();
  });

  it("uses the usage owner instead of a cross-module HTML producer", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/experience-workbench.js"),
      "utf8",
    );
    const usageStart = source.indexOf("function renderExperienceWorkbenchUsageOverviewPanel()");
    const usageEnd = source.indexOf("function findExperienceCandidateInState(", usageStart);
    const usageSource = source.slice(usageStart, usageEnd);
    const renderIndex = usageSource.indexOf("usageOverviewView.render({");
    const bindIndex = usageSource.indexOf("bindExperienceWorkbenchUsageOverviewActions();");

    expect(source).toContain('import { createExperienceWorkbenchUsageOverviewView }');
    expect(source).toContain("const usageOverviewView = createExperienceWorkbenchUsageOverviewView();");
    expect(usageSource).not.toContain("experienceWorkbenchUsageOverviewEl.innerHTML");
    expect(usageSource).not.toContain("renderTaskUsageOverviewCard");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
  });
});
