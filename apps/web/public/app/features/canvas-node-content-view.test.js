// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCanvasNodeContentView, getCanvasNodeIcon } from "./canvas-node-content-view.js";

describe("Canvas node foreignObject content DOM owner", () => {
  it("renders dynamic node content as DOM without an HTML parser", () => {
    const body = document.createElement("div");
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(body, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Canvas node content must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    const node = {
      id: 'node-1"/><img src=x onerror="alert(1)">',
      type: "task",
      data: {
        status: 'blocked"><iframe srcdoc="alert(3)">',
        title: '<img src=x onerror="alert(4)">Title',
        content: `${"x".repeat(200)}<svg onload="alert(5)">`,
        tags: ["running", '<span onclick="alert(6)">tag'],
        color: "#58a6ff",
        ref: {
          type: '<svg onload="alert(7)">memory',
          id: '<img src=x onerror="alert(8)">ref-1',
        },
      },
    };

    try {
      const view = createCanvasNodeContentView({ ownerDocument: document });
      const root = view.render(body, node, {
        activeGoalNodeId: node.id,
        activeNodeTitle: '<button onclick="alert(9)">Current activeNode</button>',
      });

      expect(body.children).toHaveLength(1);
      expect(root).toBe(body.firstElementChild);
      expect(root?.classList.contains("canvas-node")).toBe(true);
      expect(root?.classList.contains("goal-active")).toBe(true);
      expect(root?.classList.contains("react-running")).toBe(true);
      expect(root?.getAttribute("data-node-id")).toBe(node.id);
      expect(root?.style.borderLeftColor).toBeTruthy();
      expect([...root?.children ?? []].map((child) => child.className)).toEqual([
        "node-header",
        "node-body",
        "node-tags",
        "node-port node-port-top",
        "node-port node-port-bottom",
        "node-port node-port-left",
        "node-port node-port-right",
      ]);

      const header = root?.querySelector(".node-header");
      expect([...header?.children ?? []].map((child) => child.className)).toEqual([
        "node-type-icon",
        "node-status-dot",
        "node-title",
        "node-active-badge",
        "node-ref-badge",
      ]);
      expect(header?.querySelector(".node-type-icon")?.textContent).toBe("\u2611");
      expect(header?.querySelector(".node-title")?.textContent).toBe(node.data.title);
      expect(header?.querySelector(".node-active-badge")?.getAttribute("title")).toBe(
        '<button onclick="alert(9)">Current activeNode</button>',
      );
      expect(header?.querySelector(".node-ref-badge")?.getAttribute("title")).toBe(
        `${node.data.ref.type}: ${node.data.ref.id}`,
      );
      expect(root?.querySelector(".node-body")?.textContent).toBe(
        `${node.data.content.slice(0, 200)}\u2026`,
      );
      expect([...root?.querySelectorAll(".node-tag") ?? []].map((tag) => ({
        text: tag.textContent,
        dataTag: tag.getAttribute("data-tag"),
      }))).toEqual(node.data.tags.map((tag) => ({ text: tag, dataTag: tag })));
      expect([...root?.querySelectorAll(".node-port") ?? []].map((port) => port.getAttribute("data-port"))).toEqual([
        "top",
        "bottom",
        "left",
        "right",
      ]);
      expect(body.querySelector("img, svg, iframe, button, [onerror], [onload], [onclick]")).toBeNull();

      const unsafeTypeBody = document.createElement("div");
      const unsafeTypeRoot = view.render(unsafeTypeBody, {
        id: "unsafe-type",
        type: 'task"><svg onload="alert(10)">',
        data: { title: "Unknown type" },
      }, {
        activeGoalNodeId: "",
        activeNodeTitle: "Current activeNode",
      });
      expect(unsafeTypeRoot?.classList.contains("canvas-node")).toBe(true);
      expect(unsafeTypeRoot?.querySelector("svg, [onload]")).toBeNull();
    } finally {
      Object.defineProperty(body, "innerHTML", descriptor);
    }
  });

  it("keeps screenshot and collapsed-content branches, replacement, and missing-body behavior", () => {
    const view = createCanvasNodeContentView({ ownerDocument: document });
    const body = document.createElement("div");
    const screenshot = {
      id: "screenshot-1",
      type: "screenshot",
      data: {
        title: "Screenshot",
        content: "must stay hidden",
        imageUrl: 'https://example.test/image.png?x="<tag>',
      },
    };
    const first = view.render(body, screenshot, {
      activeGoalNodeId: "other",
      activeNodeTitle: "Current activeNode",
    });
    const second = view.render(body, {
      id: "collapsed-1",
      type: "note",
      data: { title: "Collapsed", content: "hidden", collapsed: true },
    }, {
      activeGoalNodeId: "",
      activeNodeTitle: "Current activeNode",
    });

    expect(first?.querySelector(".node-screenshot-img")?.getAttribute("src")).toBe(screenshot.data.imageUrl);
    expect(first?.querySelector(".node-screenshot-img")?.getAttribute("alt")).toBe("screenshot");
    expect(first?.querySelector(".node-body")).toBeNull();
    expect(first?.isConnected).toBe(false);
    expect(second?.classList.contains("goal-active")).toBe(false);
    expect(second?.querySelector(".node-body")).toBeNull();
    expect(body.children).toHaveLength(1);
    expect(getCanvasNodeIcon("task")).toBe("\u2611");
    expect(getCanvasNodeIcon("unknown")).toBe("\u25A0");
    const nullIdRoot = view.render(document.createElement("div"), {
      id: null,
      type: "note",
      data: { title: "Null id" },
    }, {
      activeGoalNodeId: "",
      activeNodeTitle: "Current activeNode",
    });
    expect(nullIdRoot?.getAttribute("data-node-id")).toBe("null");
    expect(view.render(null, screenshot, {
      activeGoalNodeId: "",
      activeNodeTitle: "Current activeNode",
    })).toBeNull();
  });

  it("keeps owner rendering before SVG append and selected-node assembly", () => {
    const canvasSource = fs.readFileSync(path.join(process.cwd(), "apps/web/public/canvas.js"), "utf8");
    const rendererStart = canvasSource.indexOf("_renderNode(node)");
    const rendererEnd = canvasSource.indexOf("_renderEdge(edge, board)", rendererStart);
    const rendererSource = canvasSource.slice(rendererStart, rendererEnd);
    const renderIndex = rendererSource.indexOf("canvasNodeContentView.render(body, node, {");
    const appendIndex = rendererSource.indexOf("fo.appendChild(body);", renderIndex);
    const selectedIndex = rendererSource.indexOf('inner.classList.add("selected")', appendIndex);

    expect(canvasSource).toContain([
      "import { createCanvasNodeContentView, getCanvasNodeIcon }",
      "from",
      '"./app/features/canvas-node-content-view.js";',
    ].join(" "));
    expect(canvasSource).toContain(
      "const canvasNodeContentView = createCanvasNodeContentView({ ownerDocument: document });",
    );
    expect(rendererSource).not.toContain("body.innerHTML");
    expect(canvasSource).not.toContain("function renderNodeHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(appendIndex).toBeGreaterThan(renderIndex);
    expect(selectedIndex).toBeGreaterThan(appendIndex);
    expect(rendererSource).toContain('body.setAttribute("xmlns", XHTML_NS);');
    expect(rendererSource).toContain('fo.setAttribute("data-node-id", node.id);');
  });
});
