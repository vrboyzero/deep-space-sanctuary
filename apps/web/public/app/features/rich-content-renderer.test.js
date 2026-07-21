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

  it("removes inline style before CSS urls can bypass media trust", () => {
    const sanitized = sanitizeRichContent(
      '<div class="css-probe" style="background-image:url(https://attacker.example/track.png)">safe</div>',
    );
    const container = document.createElement("div");
    container.innerHTML = sanitized;

    const probe = container.querySelector(".css-probe");
    expect(probe?.textContent).toBe("safe");
    expect(probe?.hasAttribute("style")).toBe(false);
  });

  it("pre-strips forbidden style markup without mutating ordinary attribute text", () => {
    const sanitized = sanitizeRichContent([
      '<span title="literal style=token">safe title</span>',
      '<div STYLE = "color: red">safe body</div>',
      '<style>.leak { background: url(https://attacker.example/track.png); }</style>',
    ].join(""));
    const container = document.createElement("div");
    container.innerHTML = sanitized;

    expect(container.querySelector("span")?.getAttribute("title")).toBe("literal style=token");
    expect(container.querySelector("div")?.hasAttribute("style")).toBe(false);
    expect(container.textContent).toContain("safe body");
    expect(container.querySelector("style")).toBeNull();
  });

  it("enforces the capability and HTTPS media url matrix for src and poster", () => {
    const sanitized = sanitizeRichContent([
      '<img class="generated" src="/generated/image.png">',
      '<img class="avatar" src="/avatar/user.png">',
      '<img class="same-origin-other" src="/api/private.png">',
      '<img class="external-https" src="https://cdn.example/image.png">',
      '<img class="external-http" src="http://cdn.example/image.png">',
      '<img class="data-url" src="data:image/png;base64,AA==">',
      '<img class="blob-url" src="blob:https://localhost/id">',
      '<img class="script-url" src="javascript:alert(1)">',
      '<audio class="audio-https" src="https://cdn.example/audio.mp3"></audio>',
      '<video class="video-capability" src="/generated/video.mp4" poster="/avatar/poster.png"></video>',
      '<video class="video-unsafe-poster" src="/generated/video.mp4" poster="data:image/png;base64,AA=="></video>',
      '<source class="source-other" src="/other/audio.mp3">',
    ].join(""));
    const container = document.createElement("div");
    container.innerHTML = sanitized;

    expect(container.querySelector(".generated")?.getAttribute("src")).toBe("/generated/image.png");
    expect(container.querySelector(".avatar")?.getAttribute("src")).toBe("/avatar/user.png");
    expect(container.querySelector(".external-https")?.getAttribute("src")).toBe("https://cdn.example/image.png");
    expect(container.querySelector(".audio-https")?.getAttribute("src")).toBe("https://cdn.example/audio.mp3");
    expect(container.querySelector(".video-capability")?.getAttribute("poster")).toBe("/avatar/poster.png");
    for (const selector of [".same-origin-other", ".external-http", ".data-url", ".blob-url", ".script-url", ".source-other"]) {
      expect(container.querySelector(selector)?.hasAttribute("src")).toBe(false);
    }
    expect(container.querySelector(".video-unsafe-poster")?.hasAttribute("poster")).toBe(false);
  });
});
