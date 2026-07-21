// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createToolSettingsMethodsTabView } from "./tool-settings-methods-tab-view.js";

const t = (_key, _params, fallback) => fallback ?? "";

describe("Tool Settings Methods tab DOM owner", () => {
  it("renders control context and method rows as text and attributes without an HTML parser", () => {
    const body = document.createElement("div");
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(body, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Tool Settings Methods tab must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createToolSettingsMethodsTabView({ ownerDocument: document, t });
      view.render(body, {
        methods: [
          {
            filename: 'zeta"><img src=x onerror="alert(1)">.md',
            title: '<svg onload="alert(2)">Zeta',
            summary: '<button onclick="alert(3)">summary',
            status: '<iframe srcdoc="alert(4)">published',
            path: 'methods/zeta"><img src=x onerror="alert(5)">.md',
          },
        {
          filename: "alpha.md",
          title: "Alpha",
          summary: "Alpha summary",
          status: "draft",
        },
        {
          title: "No path",
          summary: "Method without a source file",
        },
        ],
        toolControlView: {
          context: '<img src=x onerror="alert(6)">Agent: alpha',
          details: ['<svg onload="alert(7)">Tool Control: Confirm'],
          scopeLines: ['<button onclick="alert(8)">scope'],
          launchExplainabilityLines: ['<iframe srcdoc="alert(9)">launch'],
          runtimeLines: ['<img src=x onerror="alert(10)">runtime'],
        },
      });

      expect([...body.children].map((child) => child.className)).toEqual([
        "tool-section-header",
        "tool-settings-context",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-item method-item",
        "tool-item method-item",
        "tool-item method-item",
      ]);
      expect(body.querySelector(".tool-section-header")?.textContent).toBe("Methods3 total");
      expect(body.querySelector(".tool-settings-context")?.textContent).toBe(
        '<img src=x onerror="alert(6)">Agent: alpha',
      );
      expect([...body.querySelectorAll(".tool-settings-policy-note")].map((node) => node.textContent)).toEqual([
        '<svg onload="alert(7)">Tool Control: Confirm',
        '<button onclick="alert(8)">scope',
        '<iframe srcdoc="alert(9)">launch',
        '<img src=x onerror="alert(10)">runtime',
        "Methods is a system-level read-only index here. Review and open files from this list, but do not manage enable/disable state in this tab.",
      ]);

      const rows = [...body.querySelectorAll(".tool-item.method-item")];
      expect(rows.map((row) => row.querySelector(".tool-item-name")?.textContent)).toEqual([
        "No path",
        "Alpha",
        '<svg onload="alert(2)">Zeta',
      ]);
      expect(rows[0]?.querySelector(".tool-item-actions")).toBeNull();
      expect(rows[1]?.querySelector(".skill-meta")?.textContent).toBe("文件: alpha.md · 状态: draft");
      expect(rows[1]?.querySelector("[data-method-path]")?.getAttribute("data-method-path")).toBe("methods/alpha.md");
      const openButton = rows[2]?.querySelector("[data-method-path]");
      expect(openButton?.getAttribute("data-method-path")).toBe('methods/zeta"><img src=x onerror="alert(5)">.md');
      expect(openButton?.getAttribute("type")).toBe("button");
      expect(openButton?.className).toBe("button tool-inline-action");
      expect(body.querySelector("img, svg, iframe, button[onclick], [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(body, "innerHTML", descriptor);
    }
  });

  it("replaces old rows and ignores a missing body", () => {
    const view = createToolSettingsMethodsTabView({ ownerDocument: document, t });
    const body = document.createElement("div");
    const first = view.render(body, {
      methods: [{ filename: "first.md", title: "First", summary: "One" }],
      toolControlView: null,
    });
    const second = view.render(body, {
      methods: [{ filename: "second.md", title: "Second", summary: "Two", path: "methods/second.md" }],
      toolControlView: null,
    });

    expect(first?.isConnected).toBe(false);
    expect(second).toBe(body.firstElementChild);
    expect(body.querySelector(".tool-item-name")?.textContent).toBe("Second");
    expect(body.querySelector("[data-method-path]")?.getAttribute("data-method-path")).toBe("methods/second.md");
    expect(view.render(null, { methods: [], toolControlView: null })).toBeNull();
  });

  it("keeps owner rendering before the existing Methods open-listener assembly", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "apps/web/public/app/features/tool-settings.js"), "utf8");
    const methodsStart = source.indexOf("function renderMethodsTab(methodList, visibilityContext, toolControl)");
    const methodsEnd = source.indexOf("function renderSkillsTab", methodsStart);
    const methodsSource = source.slice(methodsStart, methodsEnd);
    const renderIndex = methodsSource.indexOf("toolSettingsMethodsTabView.render(toolSettingsBody, {");
    const bindIndex = methodsSource.indexOf("bindMethodOpenEvents();", renderIndex);

    expect(source).toContain([
      "import { createToolSettingsMethodsTabView }",
      "from",
      '"./tool-settings-methods-tab-view.js";',
    ].join(" "));
    expect(source).toContain(
      "const toolSettingsMethodsTabView = createToolSettingsMethodsTabView({",
    );
    expect(methodsSource).not.toContain("toolSettingsBody.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
    expect(methodsSource.slice(bindIndex)).toContain("bindMethodOpenEvents();");
    expect(source).toContain("updateSaveButtonAvailability();");
  });
});
