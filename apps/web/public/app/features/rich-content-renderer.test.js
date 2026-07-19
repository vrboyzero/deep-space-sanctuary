// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import createDOMPurify from "dompurify";

import { sanitizeRichContent } from "./rich-content-renderer.js";

describe("rich content renderer link trust", () => {
  beforeEach(() => {
    window.DOMPurify = createDOMPurify(window);
  });

  afterEach(() => {
    delete window.DOMPurify;
    document.body.innerHTML = "";
  });

  it("isolates external HTTPS navigation and removes attacker-selected browsing contexts", () => {
    const sanitized = sanitizeRichContent([
      '<a href="https://example.com/docs" target="_top" rel="opener">External</a>',
      '<a href="/settings" target="_parent">Same origin</a>',
    ].join(""));
    const container = document.createElement("div");
    container.innerHTML = sanitized;

    const [external, sameOrigin] = container.querySelectorAll("a");
    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(external?.getAttribute("referrerpolicy")).toBe("no-referrer");

    expect(sameOrigin?.getAttribute("target")).toBeNull();
    expect(sameOrigin?.getAttribute("referrerpolicy")).toBeNull();
  });
});
