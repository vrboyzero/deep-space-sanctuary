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
  const root = document.createElement("div");
  root.id = "sources";
  document.body.replaceChildren(root);
  const onSelectionChange = vi.fn();
  const feature = createExperienceWorkbenchSynthesisSourcesFeature({
    root,
    onSelectionChange,
  });
  return { feature, onSelectionChange, root };
}

function appendCheckboxes(root, viewModels) {
  root.replaceChildren();
  return viewModels.map((viewModel) => {
    if (!viewModel) return null;
    const label = document.createElement("label");
    label.className = `experience-synthesis-source-select${viewModel.required ? " is-required" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("data-synthesis-source-id", viewModel.candidateId);
    checkbox.checked = viewModel.checked;
    checkbox.disabled = viewModel.disabled;
    label.append(checkbox);
    root.append(label);
    return checkbox;
  });
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
      listenerCount: 0,
      disposed: false,
    });

    const [seedCheckbox, cappedCheckbox] = appendCheckboxes(fixture.root, [
      fixture.feature.getCheckboxViewModel({ candidateId: "seed-1", label: "Required" }),
      fixture.feature.getCheckboxViewModel({ candidateId: "related-3", label: "Include" }),
    ]);
    expect(seedCheckbox.checked).toBe(true);
    expect(seedCheckbox.disabled).toBe(true);
    expect(cappedCheckbox.checked).toBe(false);
    expect(cappedCheckbox.disabled).toBe(true);
  });

  it("projects source checkbox state without producing HTML", () => {
    const fixture = createFixture();
    fixture.feature.setPreview(createPreview());

    expect(fixture.feature.getCheckboxViewModel({
      candidateId: "seed-1",
      label: '<img src=x onerror=alert(1)>Required',
    })).toEqual({
      candidateId: "seed-1",
      label: '<img src=x onerror=alert(1)>Required',
      checked: true,
      disabled: true,
      required: true,
    });
    expect(fixture.feature.getCheckboxViewModel({
      candidateId: "related-3",
      label: "Include",
    })).toMatchObject({
      candidateId: "related-3",
      checked: false,
      disabled: true,
      required: false,
    });
    expect(fixture.feature.getCheckboxViewModel({ candidateId: "missing", label: "Include" })).toBeNull();
    expect(fixture.feature.renderCheckbox).toBeUndefined();
  });

  it("owns delegated changes across activation cycles without losing selection state", () => {
    const fixture = createFixture();
    fixture.feature.setPreview(createPreview());
    fixture.feature.bind();
    fixture.feature.bind();
    expect(fixture.feature.getSelectionSnapshot()).toMatchObject({
      bound: true,
      disposed: false,
    });
    const [selectedCheckbox] = appendCheckboxes(fixture.root, [
      fixture.feature.getCheckboxViewModel({ candidateId: "related-2", label: "Include" }),
      fixture.feature.getCheckboxViewModel({ candidateId: "related-3", label: "Include" }),
    ]);
    selectedCheckbox.checked = false;
    selectedCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(fixture.feature.getSelectedSourceIds()).toEqual(["seed-1", "related-1"]);
    expect(fixture.onSelectionChange).toHaveBeenCalledTimes(1);

    expect(fixture.feature.deactivate()).toBe(true);
    expect(fixture.feature.deactivate()).toBe(false);
    expect(fixture.feature.getSelectionSnapshot()).toMatchObject({
      selectedSourceCount: 2,
      bound: false,
      listenerCount: 0,
      disposed: false,
    });

    const [replacementCheckbox] = appendCheckboxes(fixture.root, [
      fixture.feature.getCheckboxViewModel({ candidateId: "related-3", label: "Include" }),
    ]);
    expect(replacementCheckbox.disabled).toBe(false);
    replacementCheckbox.checked = true;
    replacementCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(fixture.feature.getSelectedSourceIds()).toEqual(["seed-1", "related-1"]);
    expect(fixture.onSelectionChange).toHaveBeenCalledTimes(1);
    expect(fixture.feature.activate()).toBe(true);
    expect(fixture.feature.getSelectionSnapshot()).toMatchObject({ bound: true, listenerCount: 1 });
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
    expect(fixture.feature.activate()).toBe(false);
    fixture.root.innerHTML = '<input type="checkbox" data-synthesis-source-id="related-1" />';
    fixture.root.querySelector("input").dispatchEvent(new Event("change", { bubbles: true }));

    expect(fixture.onSelectionChange).not.toHaveBeenCalled();
    expect(fixture.feature.getSelectionSnapshot()).toMatchObject({
      bound: false,
      listenerCount: 0,
      disposed: true,
    });
  });
});
