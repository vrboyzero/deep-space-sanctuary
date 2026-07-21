import fs from "node:fs";

import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(new URL("../../app.js", import.meta.url), "utf8");
const experienceWorkbenchSource = fs.readFileSync(new URL("./experience-workbench.js", import.meta.url), "utf8");
const memoryDetailSource = fs.readFileSync(new URL("./memory-detail-render.js", import.meta.url), "utf8");
const memoryViewerSource = fs.readFileSync(new URL("./memory-viewer.js", import.meta.url), "utf8");

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("UI03 stage B closure", () => {
  it("physically removes migrated HTML producers and their escaper dependencies", () => {
    expect(memoryDetailSource).not.toContain("function renderTaskUsageItems");
    expect(memoryDetailSource).not.toContain("legacyTaskDetailMarkup");
    expect(memoryDetailSource).not.toContain("renderGovernanceFullOnly");
    expect(memoryDetailSource).not.toContain("renderSkillFreshnessDetail");
    expect(memoryDetailSource).not.toContain("escapeHtml");

    expect(memoryViewerSource).not.toContain("function renderSourceViewBadge");
    expect(memoryViewerSource).not.toContain("renderCandidateDetailPanel");
    expect(memoryViewerSource).not.toContain("escapeHtml");
    expect(experienceWorkbenchSource).not.toContain("escapeHtml");
  });

  it("removes bootstrap compatibility injection while retaining the DOM node contract", () => {
    const memoryDetailWiring = sliceBetween(
      appSource,
      "memoryDetailRenderFeature = createMemoryDetailRenderFeature({",
      "memoryViewerFeature = createMemoryViewerFeature({",
    );
    const memoryViewerWiring = sliceBetween(
      appSource,
      "memoryViewerFeature = createMemoryViewerFeature({",
      "experienceWorkbenchFeature = createExperienceWorkbenchFeature({",
    );
    const experienceWiring = sliceBetween(
      appSource,
      "experienceWorkbenchFeature = createExperienceWorkbenchFeature({",
      "experienceWorkbenchFeature.bindUi();",
    );

    expect(memoryDetailWiring).not.toContain("escapeHtml,");
    expect(memoryViewerWiring).not.toContain("escapeHtml,");
    expect(experienceWiring).not.toContain("escapeHtml,");
    expect(memoryViewerSource).toContain("createCandidateDetailPanel: ingressLifecycle.guard");
    expect(experienceWiring).toContain("memoryViewerFeature?.createCandidateDetailPanel");
  });
});
