// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createExperienceWorkbenchAssetLaneView } from "./experience-workbench-asset-lane-view.js";

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
      if (value) throw new Error("Experience Workbench asset lane must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Experience Workbench published asset lane DOM owner", () => {
  it("renders asset actions, attributes, states, and replacement without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createExperienceWorkbenchAssetLaneView();
    const assetPath = 'methods/demo"><img src=x onerror=alert(1)>.md';

    expect(() => view.render({
      container,
      title: "<script>Published Methods</script>",
      countLabel: "<mark>Published 1</mark>",
      emptyLabel: "<b>empty</b>",
      message: "",
      items: [{
        assetPath,
        selected: true,
        typeLabel: "<i>method</i>",
        pathLabel: "<svg onload=alert(2)>path</svg>",
        selectedLabel: "<strong>selected</strong>",
        metadataName: "<u>demo</u>",
        title: "<em>Demo</em>",
        summary: "<iframe srcdoc=alert(3)></iframe>",
        previewLabel: "<button>preview</button>",
        openSourceLabel: "<span>open</span>",
        previewDisabled: false,
        openSourceDisabled: true,
      }],
    })).not.toThrow();

    const lane = container.firstElementChild;
    const card = lane?.querySelector("[data-experience-asset-path]");
    const preview = lane?.querySelector("[data-experience-published-asset-preview]");
    const openSource = lane?.querySelector("[data-experience-published-asset-open-source]");
    expect(lane?.className).toBe("memory-usage-overview-lane");
    expect(lane?.querySelector(".memory-usage-overview-head")?.textContent).toContain("<script>Published Methods</script>");
    expect(card?.className).toBe("experience-asset-card experience-candidate-synthesized");
    expect(card?.getAttribute("data-experience-asset-path")).toBe(assetPath);
    expect(preview?.getAttribute("data-experience-published-asset-preview")).toBe(assetPath);
    expect(openSource?.getAttribute("data-experience-published-asset-open-source")).toBe(assetPath);
    expect(preview?.disabled).toBe(false);
    expect(openSource?.disabled).toBe(true);
    expect(lane?.querySelectorAll(".memory-badge")).toHaveLength(3);
    expect(lane?.textContent).toContain("<iframe srcdoc=alert(3)></iframe>");
    expect(lane?.querySelector("img, script, mark, i, svg, strong, u, em, iframe, button > button, [onerror], [onload]")).toBeNull();

    const firstLane = container.firstElementChild;
    view.render({
      container,
      title: "Published Skills",
      countLabel: "Published 0",
      emptyLabel: "No published assets",
      message: "",
      items: [],
    });
    expect(firstLane?.isConnected).toBe(false);
    expect(container.querySelector(".memory-usage-overview-empty")?.textContent).toBe("No published assets");

    view.render({
      container,
      title: "Published Skills",
      countLabel: "Published 0",
      emptyLabel: "No published assets",
      message: "<script>loading</script>",
      items: [],
    });
    expect(container.querySelector(".memory-usage-overview-empty")?.textContent).toBe("<script>loading</script>");
    expect(() => view.render({ container: null, items: [] })).not.toThrow();
  });

  it("renders the lane owner before existing asset action listener assembly", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/experience-workbench.js"),
      "utf8",
    );
    const laneStart = source.indexOf("function renderExperienceWorkbenchPublishedAssetLane(");
    const laneEnd = source.indexOf("function bindExperienceWorkbenchAssetsActions(", laneStart);
    const laneSource = source.slice(laneStart, laneEnd);
    const panelStart = source.indexOf("function renderExperienceWorkbenchAssetsPanel()", laneEnd);
    const panelEnd = source.indexOf("function renderExperienceWorkbenchUsageOverviewPanel()", panelStart);
    const panelSource = source.slice(panelStart, panelEnd);
    const renderIndex = laneSource.indexOf("assetLaneView.render({");
    const firstLaneCallIndex = panelSource.indexOf("renderExperienceWorkbenchPublishedAssetLane(");
    const bindIndex = panelSource.indexOf("bindExperienceWorkbenchAssetsActions(");

    expect(source).toContain('import { createExperienceWorkbenchAssetLaneView }');
    expect(source).toContain("const assetLaneView = createExperienceWorkbenchAssetLaneView();");
    expect(laneSource).not.toContain("container.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(firstLaneCallIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(firstLaneCallIndex);
  });
});
