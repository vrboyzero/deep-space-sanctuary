// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCanvasBoardListHeaderTitleView } from "./canvas-board-list-header-title-view.js";

describe("Canvas board list header title", () => {
  it("renders the title as a named-class text node without an HTML parser", () => {
    const header = document.createElement("div");
    header.className = "canvas-board-list-header";
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(header, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Canvas board list header title must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createCanvasBoardListHeaderTitleView({ ownerDocument: document });
      const title = '<img src=x onerror="alert(1)">Canvas Workspace';
      view.render(header, title);

      expect(header.className).toBe("canvas-board-list-header");
      expect(header.children).toHaveLength(1);
      expect(header.firstElementChild?.tagName).toBe("SPAN");
      expect(header.firstElementChild?.className).toBe("canvas-board-list-title");
      expect(header.firstElementChild?.textContent).toBe(title);
      expect(header.firstElementChild?.getAttribute("style")).toBeNull();
      expect(header.querySelector("img, svg, [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(header, "innerHTML", descriptor);
    }
  });

  it("replaces the previous title and ignores a missing header", () => {
    const view = createCanvasBoardListHeaderTitleView({ ownerDocument: document });
    const header = document.createElement("div");

    view.render(header, "first");
    const firstChild = header.firstElementChild;
    view.render(header, "second");

    expect(header.children).toHaveLength(1);
    expect(header.firstElementChild).not.toBe(firstChild);
    expect(header.textContent).toBe("second");
    expect(() => view.render(null, "ignored")).not.toThrow();
  });

  it("keeps header title rendering before the existing button assembly", () => {
    const canvasSource = fs.readFileSync(path.join(process.cwd(), "apps/web/public/canvas.js"), "utf8");
    const renderCall = "canvasBoardListHeaderTitleView.render(header, t(";
    const renderIndex = canvasSource.indexOf(renderCall);
    const buttonAssemblyIndex = canvasSource.indexOf("const headerBtns =", renderIndex);

    expect(canvasSource).toContain([
      "import { createCanvasBoardListHeaderTitleView }",
      "from",
      '"./app/features/canvas-board-list-header-title-view.js";',
    ].join(" "));
    expect(canvasSource).toContain(
      "const canvasBoardListHeaderTitleView = createCanvasBoardListHeaderTitleView({ ownerDocument: document });",
    );
    expect(canvasSource).toContain('header.className = "canvas-board-list-header";');
    expect(canvasSource).not.toContain("header.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(buttonAssemblyIndex).toBeGreaterThan(renderIndex);
    expect(canvasSource.slice(buttonAssemblyIndex)).toContain('newBtn.addEventListener("click"');
    expect(canvasSource.slice(buttonAssemblyIndex)).toContain('backBtn.addEventListener("click"');
    expect(canvasSource.slice(buttonAssemblyIndex)).toContain("header.appendChild(headerBtns);");
  });
});
