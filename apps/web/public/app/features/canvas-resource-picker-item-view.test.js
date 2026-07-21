// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCanvasResourcePickerItemView } from "./canvas-resource-picker-item-view.js";

describe("Canvas resource picker item", () => {
  it("renders resource metadata as text without an HTML parser", () => {
    const row = document.createElement("div");
    row.className = "canvas-picker-item";
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(row, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Canvas resource picker items must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createCanvasResourcePickerItemView({ ownerDocument: document });
      const item = {
        name: '<img src=x onerror="alert(1)">Resource',
        desc: '<svg onload="alert(2)">Description</svg>',
      };
      view.render(row, item);

      expect(row.className).toBe("canvas-picker-item");
      expect([...row.children].map((child) => child.className)).toEqual([
        "canvas-picker-item-name",
        "canvas-picker-item-desc",
      ]);
      expect(row.children[0]?.textContent).toBe(item.name);
      expect(row.children[1]?.textContent).toBe(item.desc);
      expect(row.querySelector("img, svg, [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(row, "innerHTML", descriptor);
    }
  });

  it("keeps the description optional, replaces old children, and ignores a missing row", () => {
    const view = createCanvasResourcePickerItemView({ ownerDocument: document });
    const row = document.createElement("div");

    view.render(row, { name: "first", desc: "" });
    const firstName = row.firstElementChild;
    expect(row.children).toHaveLength(1);
    expect(row.firstElementChild?.className).toBe("canvas-picker-item-name");

    view.render(row, { name: "second", desc: "details" });
    expect(row.children).toHaveLength(2);
    expect(row.firstElementChild).not.toBe(firstName);
    expect(row.textContent).toBe("seconddetails");
    expect(() => view.render(null, { name: "ignored", desc: "ignored" })).not.toThrow();
  });

  it("keeps item rendering before the existing click and append assembly", () => {
    const canvasSource = fs.readFileSync(path.join(process.cwd(), "apps/web/public/canvas.js"), "utf8");
    const renderCall = "canvasResourcePickerItemView.render(row, item);";
    const renderIndex = canvasSource.indexOf(renderCall);
    const clickIndex = canvasSource.indexOf('row.addEventListener("click"', renderIndex);
    const appendIndex = canvasSource.indexOf("body.appendChild(row);", clickIndex);

    expect(canvasSource).toContain([
      "import { createCanvasResourcePickerItemView }",
      "from",
      '"./app/features/canvas-resource-picker-item-view.js";',
    ].join(" "));
    expect(canvasSource).toContain(
      "const canvasResourcePickerItemView = createCanvasResourcePickerItemView({ ownerDocument: document });",
    );
    expect(canvasSource).not.toContain("row.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(clickIndex).toBeGreaterThan(renderIndex);
    expect(appendIndex).toBeGreaterThan(clickIndex);
    expect(canvasSource.slice(clickIndex, appendIndex)).toContain("close();");
    expect(canvasSource.slice(clickIndex, appendIndex)).toContain("this.manager.addNode(type, item.name");
    expect(canvasSource.slice(clickIndex, appendIndex)).toContain("ref: { type: refType, id: item.id }");
    expect(canvasSource.slice(clickIndex, appendIndex)).toContain("content: item.content || undefined");
    expect(canvasSource.slice(clickIndex, appendIndex)).toContain("this._rerender()");
    expect(canvasSource.slice(clickIndex, appendIndex)).toContain("this._scheduleSave()");
  });
});
