// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCanvasNodeEditDialogView } from "./canvas-node-edit-dialog-view.js";

describe("Canvas node edit dialog", () => {
  it("renders the form shell with text and form properties without an HTML parser", () => {
    const dialog = document.createElement("div");
    dialog.className = "canvas-picker-dialog";
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(dialog, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Canvas node edit dialog must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createCanvasNodeEditDialogView({ ownerDocument: document });
      const fields = {
        dialogTitle: '<img src=x onerror="alert(1)">Edit Node',
        titleLabel: '<svg onload="alert(2)">Title</svg>',
        contentLabel: '<button onclick="alert(3)">Content</button>',
        saveLabel: '<iframe srcdoc="alert(4)">Save</iframe>',
        title: '"/><img src=x onerror="alert(5)">',
        content: '</textarea><svg onload="alert(6)">content',
      };
      const parts = view.render(dialog, fields);

      expect(dialog.className).toBe("canvas-picker-dialog");
      expect([...dialog.children].map((child) => child.className)).toEqual([
        "canvas-picker-header",
        "canvas-picker-body canvas-picker-body--edit",
        "canvas-picker-footer",
      ]);
      expect(dialog.children[0]?.children[0]?.textContent).toBe(fields.dialogTitle);
      expect(parts.closeButton?.className).toBe("canvas-picker-close");
      expect(parts.closeButton?.textContent).toBe("\u00D7");
      expect(parts.titleInput?.className).toBe("canvas-edit-title");
      expect(parts.titleInput?.value).toBe(fields.title);
      expect(parts.titleInput?.defaultValue).toBe(fields.title);
      expect(parts.contentInput?.className).toBe("canvas-edit-content");
      expect(parts.contentInput?.value).toBe(fields.content);
      expect(parts.contentInput?.defaultValue).toBe(fields.content);
      expect(parts.contentInput?.getAttribute("rows")).toBe("5");
      expect(parts.titleInput?.getAttribute("style")).toBeNull();
      expect(parts.contentInput?.getAttribute("style")).toBeNull();
      expect(parts.saveButton?.className).toBe("canvas-picker-save");
      expect(parts.saveButton?.textContent).toBe(fields.saveLabel);
      expect(dialog.querySelector("img, svg, iframe, [onerror], [onload], [onclick]")).toBeNull();
    } finally {
      Object.defineProperty(dialog, "innerHTML", descriptor);
    }
  });

  it("replaces old form controls and returns null parts for a missing dialog", () => {
    const view = createCanvasNodeEditDialogView({ ownerDocument: document });
    const dialog = document.createElement("div");
    const first = view.render(dialog, {
      dialogTitle: "first",
      titleLabel: "title",
      contentLabel: "content",
      saveLabel: "save",
      title: "one",
      content: "body one",
    });
    const second = view.render(dialog, {
      dialogTitle: "second",
      titleLabel: "title two",
      contentLabel: "content two",
      saveLabel: "save two",
      title: "two",
      content: "body two",
    });

    expect(first.titleInput?.isConnected).toBe(false);
    expect(second.titleInput).not.toBe(first.titleInput);
    expect(dialog.children).toHaveLength(3);
    expect(dialog.textContent).toBe("second\u00D7title twocontent twobody twosave two");
    expect(view.render(null, {
      dialogTitle: "ignored",
      titleLabel: "ignored",
      contentLabel: "ignored",
      saveLabel: "ignored",
      title: "ignored",
      content: "ignored",
    })).toEqual({
      closeButton: null,
      saveButton: null,
      titleInput: null,
      contentInput: null,
    });
  });

  it("keeps form rendering before the existing focus and save assembly", () => {
    const canvasSource = fs.readFileSync(path.join(process.cwd(), "apps/web/public/canvas.js"), "utf8");
    const editStart = canvasSource.indexOf("_editNodeDialog(nodeId)");
    const editEnd = canvasSource.indexOf("// ── Canvas Snapshot", editStart);
    const editSource = canvasSource.slice(editStart, editEnd);
    const renderIndex = editSource.indexOf("canvasNodeEditDialogView.render(dialog, {");
    const appendIndex = editSource.indexOf("overlay.appendChild(dialog);", renderIndex);
    const focusIndex = editSource.indexOf("titleInput.focus();", appendIndex);
    const saveIndex = editSource.indexOf('saveBtn.addEventListener("click"', focusIndex);

    expect(canvasSource).toContain([
      "import { createCanvasNodeEditDialogView }",
      "from",
      '"./app/features/canvas-node-edit-dialog-view.js";',
    ].join(" "));
    expect(canvasSource).toContain(
      "const canvasNodeEditDialogView = createCanvasNodeEditDialogView({ ownerDocument: document });",
    );
    expect(editSource).not.toContain("dialog.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(appendIndex).toBeGreaterThan(renderIndex);
    expect(focusIndex).toBeGreaterThan(appendIndex);
    expect(saveIndex).toBeGreaterThan(focusIndex);
    expect(editSource.slice(saveIndex)).toContain("const newTitle = titleInput.value.trim();");
    expect(editSource.slice(saveIndex)).toContain("const newContent = contentInput.value;");
    expect(editSource.slice(saveIndex)).toContain("this.manager.updateNode(nodeId, updates);");
    expect(editSource.slice(saveIndex)).toContain("this._rerender();");
    expect(editSource.slice(saveIndex)).toContain("this._scheduleSave();");
    expect(editSource.slice(saveIndex)).toContain("close();");
  });
});
