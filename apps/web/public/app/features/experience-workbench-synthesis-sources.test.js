// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchSynthesisSourcesFeature } from "./experience-workbench-synthesis-sources.js";

function createPreview() {
  return {
    seedCandidate: { id: "seed-1" },
    sourceCandidateIds: ["seed-1", "related-1", "related-2"],
    maxSimilarSourceCount: 2,
    items: [
      { candidateId: "related-1", relation: "same_family" },
      { candidateId: "related-2", relation: "similar" },
      { candidateId: "related-3", relation: "similar" },
    ],
  };
}

function createFixture() {
  document.body.innerHTML = '<div id="sources"></div>';
  const onSelectionChange = vi.fn();
  const feature = createExperienceWorkbenchSynthesisSourcesFeature({
    root: document.getElementById("sources"),
    escapeHtml: (value) => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
    onSelectionChange,
  });
  return { feature, onSelectionChange, root: document.getElementById("sources") };
}

describe("experience workbench synthesis source selection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("initializes from the server-selected subset and pins the seed", () => {
    const fixture = createFixture();

    fixture.feature.setPreview(createPreview());

    expect(fixture.feature.getSelectedSourceIds()).toEqual(["seed-1", "related-1", "related-2"]);
    expect(fixture.feature.getSelectionSnapshot()).toEqual({
      availableSourceCount: 4,
      selectedSourceCount: 3,
      selectedSameFamilyCount: 1,
      selectedSimilarCount: 1,
      maxRelatedSourceCount: 2,
      initialized: true,
      bound: false,
      disposed: false,
    });

    fixture.root.innerHTML = [
      fixture.feature.renderCheckbox({ candidateId: "seed-1", label: "Required" }),
      fixture.feature.renderCheckbox({ candidateId: "related-3", label: "Include" }),
    ].join("");
    const seedCheckbox = fixture.root.querySelector("[data-synthesis-source-id='seed-1']");
    const cappedCheckbox = fixture.root.querySelector("[data-synthesis-source-id='related-3']");
    expect(seedCheckbox.checked).toBe(true);
    expect(seedCheckbox.disabled).toBe(true);
    expect(cappedCheckbox.checked).toBe(false);
    expect(cappedCheckbox.disabled).toBe(true);
  });

  it("moves capacity between related sources through one delegated change owner", () => {
    const fixture = createFixture();
    fixture.feature.setPreview(createPreview());
    fixture.feature.bind();
    fixture.feature.bind();
    fixture.root.innerHTML = [
      fixture.feature.renderCheckbox({ candidateId: "related-2", label: "Include" }),
      fixture.feature.renderCheckbox({ candidateId: "related-3", label: "Include" }),
    ].join("");

    const selectedCheckbox = fixture.root.querySelector("[data-synthesis-source-id='related-2']");
    selectedCheckbox.checked = false;
    selectedCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(fixture.feature.getSelectedSourceIds()).toEqual(["seed-1", "related-1"]);
    expect(fixture.onSelectionChange).toHaveBeenCalledTimes(1);

    fixture.root.innerHTML = fixture.feature.renderCheckbox({ candidateId: "related-3", label: "Include" });
    const replacementCheckbox = fixture.root.querySelector("[data-synthesis-source-id='related-3']");
    expect(replacementCheckbox.disabled).toBe(false);
    replacementCheckbox.checked = true;
    replacementCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(fixture.feature.getSelectedSourceIds()).toEqual(["seed-1", "related-1", "related-3"]);
    expect(fixture.feature.getSelectionSnapshot()).toMatchObject({
      selectedSourceCount: 3,
      selectedSameFamilyCount: 1,
      selectedSimilarCount: 1,
    });
    expect(fixture.onSelectionChange).toHaveBeenCalledTimes(2);
  });

  it("clears selection state and removes its listener on dispose", () => {
    const fixture = createFixture();
    fixture.feature.setPreview(createPreview());
    fixture.feature.bind();
    fixture.feature.clear();

    expect(fixture.feature.getSelectedSourceIds()).toEqual([]);
    expect(fixture.feature.getSelectionSnapshot()).toMatchObject({
      availableSourceCount: 0,
      selectedSourceCount: 0,
      initialized: false,
      bound: true,
    });

    fixture.feature.dispose();
    fixture.root.innerHTML = '<input type="checkbox" data-synthesis-source-id="related-1" />';
    fixture.root.querySelector("input").dispatchEvent(new Event("change", { bubbles: true }));

    expect(fixture.onSelectionChange).not.toHaveBeenCalled();
    expect(fixture.feature.getSelectionSnapshot()).toMatchObject({ bound: false, disposed: true });
  });
});
