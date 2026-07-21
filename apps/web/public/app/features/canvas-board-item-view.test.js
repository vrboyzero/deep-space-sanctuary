// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCanvasBoardItemView } from "./canvas-board-item-view.js";

describe("Canvas board item DOM owner", () => {
  it("renders board name and id as ordered text nodes without an HTML parser", () => {
    const item = document.createElement("div");
    item.className = "canvas-board-item";
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(item, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Canvas board item must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createCanvasBoardItemView({ ownerDocument: document });
      view.render(item, {
        name: '<img src=x onerror="alert(1)">.json',
        id: '<svg onload="alert(1)">board-1',
      });

      expect(item.className).toBe("canvas-board-item");
      expect([...item.children].map((child) => child.className)).toEqual([
        "canvas-board-item-name",
        "canvas-board-item-meta",
      ]);
      expect(item.children[0]?.textContent).toBe('<img src=x onerror="alert(1)">');
      expect(item.children[1]?.textContent).toBe('ID: <svg onload="alert(1)">board-1');
      expect(item.querySelector("img, svg, [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(item, "innerHTML", descriptor);
    }
  });

  it("replaces an existing item and ignores a missing item", () => {
    const view = createCanvasBoardItemView({ ownerDocument: document });
    const item = document.createElement("div");
    item.append(document.createElement("span"));

    view.render(item, { name: "first.json", id: "board-1" });
    const firstChildren = [...item.children];
    view.render(item, { name: "second.json", id: "board-2" });

    expect([...item.children]).toHaveLength(2);
    expect([...item.children]).not.toEqual(firstChildren);
    expect(item.children[0]?.textContent).toBe("second");
    expect(item.children[1]?.textContent).toBe("ID: board-2");
    expect(() => view.render(null, { name: "ignored.json", id: "ignored" })).not.toThrow();
  });

  it("keeps canvas.js limited to owner forwarding before the existing click wiring", () => {
    const canvasSource = fs.readFileSync(path.join(process.cwd(), "apps/web/public/canvas.js"), "utf8");
    const renderCall = "canvasBoardItemView.render(item, b);";
    const renderIndex = canvasSource.indexOf(renderCall);
    const clickIndex = canvasSource.indexOf('item.addEventListener("click"', renderIndex);

    expect(canvasSource).toContain([
      "import { createCanvasBoardItemView }",
      "from",
      '"./app/features/canvas-board-item-view.js";',
    ].join(" "));
    expect(canvasSource).toContain(
      "const canvasBoardItemView = createCanvasBoardItemView({ ownerDocument: document });",
    );
    expect(canvasSource).not.toContain("item.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(clickIndex).toBeGreaterThan(renderIndex);
    expect(canvasSource.slice(clickIndex, clickIndex + 180)).toContain("await this.openBoard(b.id);");
    expect(canvasSource.slice(clickIndex, clickIndex + 180)).toContain("this._showCanvasView();");
  });
});
