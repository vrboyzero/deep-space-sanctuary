// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCanvasResourcePickerDialogView } from "./canvas-resource-picker-dialog-view.js";

describe("Canvas resource picker dialog", () => {
  it("renders the dialog shell as fixed DOM with text-only labels", () => {
    const dialog = document.createElement("div");
    dialog.className = "canvas-picker-dialog";
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(dialog, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Canvas resource picker dialog must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createCanvasResourcePickerDialogView({ ownerDocument: document });
      const title = '<img src=x onerror="alert(1)">Choose resource';
      const manualLabel = '<svg onload="alert(2)">Manual Input</svg>';
      const parts = view.render(dialog, { title, manualLabel });

      expect(dialog.className).toBe("canvas-picker-dialog");
      expect([...dialog.children].map((child) => child.className)).toEqual([
        "canvas-picker-header",
        "canvas-picker-body",
        "canvas-picker-footer",
      ]);
      expect(dialog.children[0]?.children[0]?.tagName).toBe("SPAN");
      expect(dialog.children[0]?.children[0]?.textContent).toBe(title);
      expect(parts.closeButton?.className).toBe("canvas-picker-close");
      expect(parts.closeButton?.textContent).toBe("\u00D7");
      expect(parts.body).toBe(dialog.children[1]);
      expect(parts.manualButton?.className).toBe("canvas-picker-manual");
      expect(parts.manualButton?.textContent).toBe(manualLabel);
      expect(parts.manualButton?.parentElement).toBe(dialog.children[2]);
      expect(dialog.querySelector("img, svg, [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(dialog, "innerHTML", descriptor);
    }
  });

  it("replaces the previous shell and returns null parts for a missing dialog", () => {
    const view = createCanvasResourcePickerDialogView({ ownerDocument: document });
    const dialog = document.createElement("div");

    const first = view.render(dialog, { title: "first", manualLabel: "manual one" });
    const second = view.render(dialog, { title: "second", manualLabel: "manual two" });

    expect(first.body?.isConnected).toBe(false);
    expect(second.body).not.toBe(first.body);
    expect(dialog.children).toHaveLength(3);
    expect(dialog.textContent).toBe("second\u00D7manual two");
    expect(view.render(null, { title: "ignored", manualLabel: "ignored" })).toEqual({
      body: null,
      closeButton: null,
      manualButton: null,
    });
  });

  it("keeps shell rendering before the existing overlay and listener assembly", () => {
    const canvasSource = fs.readFileSync(path.join(process.cwd(), "apps/web/public/canvas.js"), "utf8");
    const pickerStart = canvasSource.indexOf("async _showResourcePicker(type)");
    const pickerEnd = canvasSource.indexOf("async _fetchResources(type)", pickerStart);
    const pickerSource = canvasSource.slice(pickerStart, pickerEnd);
    const renderIndex = pickerSource.indexOf("canvasResourcePickerDialogView.render(dialog, {");
    const overlayAppendIndex = pickerSource.indexOf("overlay.appendChild(dialog);", renderIndex);
    const closeListenerIndex = pickerSource.indexOf('closeBtn.addEventListener("click", close);', overlayAppendIndex);

    expect(canvasSource).toContain([
      "import { createCanvasResourcePickerDialogView }",
      "from",
      '"./app/features/canvas-resource-picker-dialog-view.js";',
    ].join(" "));
    expect(canvasSource).toContain(
      "const canvasResourcePickerDialogView = createCanvasResourcePickerDialogView({ ownerDocument: document });",
    );
    expect(pickerSource).not.toContain("dialog.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(overlayAppendIndex).toBeGreaterThan(renderIndex);
    expect(closeListenerIndex).toBeGreaterThan(overlayAppendIndex);
    expect(pickerSource).toContain('overlay.addEventListener("click"');
    expect(pickerSource).toContain('manualBtn.addEventListener("click"');
    expect(pickerSource).toContain("canvasResourcePickerEmptyView.render(body, t(");
    expect(pickerSource).toContain("canvasResourcePickerItemView.render(row, item);");
    expect(pickerSource).toContain("this.manager.addNode(type, title)");
  });
});
