// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createModelSelectionPersistenceFeature } from "./persistence.js";

describe("model selection persistence lifecycle", () => {
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("persists model changes until dispose", () => {
    document.body.innerHTML = `
      <select id="model">
        <option value="">Default</option>
        <option value="model-a">Model A</option>
      </select>
    `;
    const select = document.getElementById("model");
    const feature = createModelSelectionPersistenceFeature({
      select,
      storageKey: "test.model",
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 1, disposed: false });
    select.value = "model-a";
    select.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("test.model")).toBe("model-a");
    select.value = "";
    select.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("test.model")).toBeNull();

    localStorage.setItem("test.model", "retained");
    feature.dispose();
    feature.dispose();
    select.value = "model-a";
    select.dispatchEvent(new Event("change"));
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(localStorage.getItem("test.model")).toBe("retained");
  });
});
