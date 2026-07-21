// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCanvasResourcePickerEmptyView } from "./canvas-resource-picker-empty-view.js";

describe("Canvas resource picker empty view", () => {
  it("renders the empty message as one text child and preserves the body root", () => {
    const body = document.createElement("div");
    body.className = "canvas-picker-body";
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(body, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Canvas resource picker empty state must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createCanvasResourcePickerEmptyView({ ownerDocument: document });
      const message = '<img src=x onerror="alert(1)">No resources';
      view.render(body, message);

      expect(body.className).toBe("canvas-picker-body");
      expect(body.children).toHaveLength(1);
      expect(body.firstElementChild?.className).toBe("canvas-picker-empty");
      expect(body.firstElementChild?.textContent).toBe(message);
      expect(body.querySelector("img, svg, [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(body, "innerHTML", descriptor);
    }
  });

  it("replaces the previous empty message and ignores a missing body", () => {
    const view = createCanvasResourcePickerEmptyView({ ownerDocument: document });
    const body = document.createElement("div");

    view.render(body, "first");
    const firstChild = body.firstElementChild;
    view.render(body, "second");

    expect(body.children).toHaveLength(1);
    expect(body.firstElementChild).not.toBe(firstChild);
    expect(body.textContent).toBe("second");
    expect(() => view.render(null, "ignored")).not.toThrow();
  });

  it("keeps the empty branch delegated while preserving non-empty picker wiring", () => {
    const canvasSource = fs.readFileSync(path.join(process.cwd(), "apps/web/public/canvas.js"), "utf8");
    const branchStart = canvasSource.indexOf("if (items.length === 0)");
    const branchEnd = canvasSource.indexOf("} else {", branchStart);
    const emptyBranch = canvasSource.slice(branchStart, branchEnd);

    expect(canvasSource).toContain([
      "import { createCanvasResourcePickerEmptyView }",
      "from",
      '"./app/features/canvas-resource-picker-empty-view.js";',
    ].join(" "));
    expect(canvasSource).toContain(
      "const canvasResourcePickerEmptyView = createCanvasResourcePickerEmptyView({ ownerDocument: document });",
    );
    expect(emptyBranch).toContain("canvasResourcePickerEmptyView.render(body, t(");
    expect(emptyBranch).not.toContain("body.innerHTML");
    expect(canvasSource.slice(branchEnd)).toContain("canvasResourcePickerItemView.render(row, item);");
    expect(canvasSource.slice(branchEnd)).not.toContain("row.innerHTML");
    expect(canvasSource.slice(branchEnd)).toContain('row.addEventListener("click"');
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
  });
});
