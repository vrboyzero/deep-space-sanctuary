// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createToolSettingsEmptyStateView } from "./tool-settings-empty-state.js";

describe("Tool Settings empty state DOM owner", () => {
  it("renders localized empty text and replaces the prior state", () => {
    const target = document.createElement("div");
    const view = createToolSettingsEmptyStateView({
      ownerDocument: document,
      t: (key) => `<img data-key="${key}" onerror="alert(1)">locale`,
    });

    view.render(target, "toolSettings.emptyLoading", "Loading...");
    expect(target.children).toHaveLength(1);
    expect(target.firstElementChild?.className).toBe("tool-settings-empty");
    expect(target.textContent).toBe('<img data-key="toolSettings.emptyLoading" onerror="alert(1)">locale');
    expect(target.querySelector("img, svg, [onerror]")).toBeNull();

    view.render(target, "toolSettings.emptyNoMethods", "No methods");
    expect(target.children).toHaveLength(1);
    expect(target.textContent).toContain("toolSettings.emptyNoMethods");
  });

  it("treats missing targets as a no-op", () => {
    const view = createToolSettingsEmptyStateView({ ownerDocument: document, t: () => "empty" });
    expect(() => view.render(null, "toolSettings.emptyLoading", "Loading...")).not.toThrow();
  });
});
