// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerDedupWarningView } from "./memory-viewer-dedup-warning-view.js";

afterEach(() => {
  document.body.replaceChildren();
});

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Memory Viewer dedup warning must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer dedup warning DOM owner", () => {
  it("renders nonblank warning lines as text in their original order without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerDedupWarningView();
    const backupPath = 'state/<img src=x onerror=alert(1)>/memory.sqlite';
    const fileSizeHint = "<script>alert(2)</script>SQLite hint";

    expect(() => view.render({
      container,
      lines: ["", "   ", `已生成备份：${backupPath}`, null, fileSizeHint],
    })).not.toThrow();

    expect([...container.children].map((element) => element.textContent)).toEqual([
      `已生成备份：${backupPath}`,
      fileSizeHint,
    ]);
    expect(container.querySelector("img, script, [onerror]")).toBeNull();
  });

  it("replaces previous warning lines and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerDedupWarningView();
    view.render({ container, lines: ["旧提示"] });
    const previousLine = container.firstElementChild;

    view.render({ container, lines: ["  新提示  ", "", "\t"] });

    expect(previousLine?.isConnected).toBe(false);
    expect([...container.children].map((element) => element.textContent)).toEqual(["  新提示  "]);
    expect(() => view.render({ container: null, lines: ["忽略"] })).not.toThrow();
  });

  it("uses the warning owner instead of writing the modal warning root as HTML", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const dedupStart = source.indexOf("function renderDedupModal()");
    const dedupEnd = source.indexOf("if (modalState.loading)", dedupStart);
    const dedupSource = source.slice(dedupStart, dedupEnd);

    expect(source).toContain('import { createMemoryViewerDedupWarningView }');
    expect(source).toContain("const dedupWarningView = createMemoryViewerDedupWarningView();");
    expect(dedupSource).not.toContain("memoryDedupModalWarningEl.innerHTML");
    expect(dedupSource).toContain("dedupWarningView.render({");
  });
});
