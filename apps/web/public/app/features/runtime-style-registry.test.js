// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { clearRuntimeStyles, setRuntimeStyles, toRuntimeStyleUrl } from "./runtime-style-registry.js";

function installStyleSheet() {
  const style = document.createElement("style");
  style.setAttribute("data-ui03-runtime-stylesheet", "true");
  document.head.appendChild(style);
  return style;
}

afterEach(() => {
  document.head.querySelectorAll("style[data-ui03-runtime-stylesheet]").forEach((element) => element.remove());
  document.body.replaceChildren();
});

describe("runtime style registry", () => {
  it("writes a releasable rule into the supplied stylesheet without adding a style attribute", () => {
    const style = installStyleSheet();
    const target = document.createElement("div");
    document.body.appendChild(target);

    expect(setRuntimeStyles(target, { width: "24px", "overflow-y": "auto" })).toBe(true);
    expect(target.getAttribute("style")).toBeNull();
    expect(target.className).toMatch(/^webchat-runtime-style-/);
    expect(style.sheet?.cssRules).toHaveLength(1);
    expect(style.sheet?.cssRules[0]?.style.getPropertyValue("width")).toBe("24px");

    expect(clearRuntimeStyles(target)).toBe(true);
    expect(target.className).toBe("");
    expect(style.sheet?.cssRules).toHaveLength(0);
  });

  it("allows only controlled CSS properties and serializes supported image URLs", () => {
    const target = document.createElement("div");
    installStyleSheet();

    expect(() => setRuntimeStyles(target, { "grid-template-columns": "1fr" }))
      .toThrow("Unsupported runtime style property");
    expect(toRuntimeStyleUrl("/avatar/test.png")).toMatch(/^url\("http:\/\/localhost(?::\d+)?\/avatar\/test\.png"\)$/);
    expect(toRuntimeStyleUrl("javascript:alert(1)")).toBe("none");
  });

  it("releases a detached element rule without restoring an inline style fallback", async () => {
    const style = installStyleSheet();
    const target = document.createElement("div");
    document.body.appendChild(target);
    expect(setRuntimeStyles(target, { width: "48px" })).toBe(true);

    target.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(style.sheet?.cssRules).toHaveLength(0);
    expect(target.getAttribute("style")).toBeNull();
  });
});
