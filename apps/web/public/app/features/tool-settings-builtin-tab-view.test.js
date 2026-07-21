// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createToolSettingsBuiltinTabView } from "./tool-settings-builtin-tab-view.js";

const t = (_key, _params, fallback) => fallback ?? "";

describe("Tool Settings Builtin tab DOM owner", () => {
  it("renders builtin contracts, workflow capability, visibility, and checkbox data as text, properties, and attributes without an HTML parser", () => {
    const body = document.createElement("div");
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(body, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Tool Settings Builtin tab must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createToolSettingsBuiltinTabView({ ownerDocument: document, t });
      view.render(body, {
        tools: [
          {
            name: 'zeta"><img src=x onerror="alert(1)">',
            checked: false,
            contract: null,
            visibility: {
              available: false,
              label: '<svg onload="alert(2)">Blocked',
              alwaysEnabled: true,
              alwaysEnabledLabel: '<button onclick="alert(3)">Always',
              reasonMessage: '<iframe srcdoc="alert(4)">reason',
            },
          },
          {
            name: "alpha_builtin",
            checked: true,
            contract: {
              description: '<button onclick="alert(5)">description',
              badges: [
                { className: "family", label: '<svg onload="alert(6)">Family' },
                { className: "risk-critical", label: '<iframe srcdoc="alert(7)">Critical' },
                { className: "mode-read", label: "Read-only" },
                { className: "permission-needed", label: "Permission Required" },
                { className: "", label: '<img src=x onerror="alert(8)">Output' },
              ],
              meta: '<button onclick="alert(9)">Scopes: local-safe',
            },
            visibility: {
              available: true,
              label: "Visible in Current Context",
              alwaysEnabled: false,
              alwaysEnabledLabel: "Always Enabled",
              reasonMessage: "",
            },
          },
        ],
        enabledCount: 1,
        toolControlView: {
          context: '<img src=x onerror="alert(10)">Agent: alpha',
          details: ['<svg onload="alert(11)">Tool Control: Confirm'],
          scopeLines: ['<button onclick="alert(12)">scope'],
          launchExplainabilityLines: ['<iframe srcdoc="alert(13)">launch'],
          runtimeLines: ['<img src=x onerror="alert(14)">runtime'],
        },
        workflowCapabilityView: {
          title: '<strong>Workflow</strong>',
          status: '<button onclick="alert(15)">Ready',
          reason: '<svg onload="alert(16)">reason',
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
        "tool-item",
        "tool-item disabled unavailable",
      ]);
      expect(body.querySelector(".tool-section-header")?.textContent).toBe("Built-in Tools1/2 enabled");
      expect(body.querySelector(".tool-settings-context")?.textContent).toBe(
        '<img src=x onerror="alert(10)">Agent: alpha',
      );
      expect([...body.querySelectorAll(".tool-settings-policy-note")].map((node) => node.textContent)).toEqual([
        '<svg onload="alert(11)">Tool Control: Confirm',
        '<button onclick="alert(12)">scope',
        '<iframe srcdoc="alert(13)">launch',
        '<img src=x onerror="alert(14)">runtime',
        '<strong>Workflow</strong> · <button onclick="alert(15)">Ready<svg onload="alert(16)">reason',
      ]);

      const rows = [...body.querySelectorAll(".tool-item")];
      expect(rows.map((row) => row.querySelector(".tool-item-name")?.textContent)).toEqual([
        "alpha_builtin",
        'zeta"><img src=x onerror="alert(1)">',
      ]);
      expect(rows[0]?.querySelector(".tool-contract-desc")?.textContent).toBe(
        '<button onclick="alert(5)">description',
      );
      expect([...rows[0]?.querySelectorAll(".tool-contract-badge") ?? []].map((node) => node.className)).toEqual([
        "tool-contract-badge family",
        "tool-contract-badge risk-critical",
        "tool-contract-badge mode-read",
        "tool-contract-badge permission-needed",
        "tool-contract-badge",
        "tool-contract-badge visibility-available",
      ]);
      expect(rows[0]?.querySelector(".tool-contract-meta")?.textContent).toBe(
        '<button onclick="alert(9)">Scopes: local-safe',
      );
      expect(rows[1]?.querySelector(".tool-contract-desc")).toBeNull();
      expect(rows[1]?.querySelector(".tool-contract-badges")).toBeNull();

      const zetaInput = rows[1]?.querySelector("input[type=checkbox]");
      expect(zetaInput?.checked).toBe(false);
      expect(zetaInput?.getAttribute("data-category")).toBe("builtin");
      expect(zetaInput?.getAttribute("data-name")).toBe('zeta"><img src=x onerror="alert(1)">');
      expect(rows[1]?.querySelector(".tool-visibility-badges")?.textContent).toBe(
        '<svg onload="alert(2)">Blocked<button onclick="alert(3)">Always',
      );
      expect(rows[1]?.querySelector(".tool-visibility-reason")?.textContent).toBe(
        '<iframe srcdoc="alert(4)">reason',
      );
      expect(body.querySelector("img, svg, iframe, button[onclick], [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(body, "innerHTML", descriptor);
    }
  });

  it("replaces old rows and ignores a missing body", () => {
    const view = createToolSettingsBuiltinTabView({ ownerDocument: document, t });
    const body = document.createElement("div");
    const first = view.render(body, {
      tools: [{ name: "first", checked: true, contract: null, visibility: null }],
      enabledCount: 1,
      toolControlView: null,
      workflowCapabilityView: null,
    });
    const second = view.render(body, {
      tools: [{ name: "second", checked: false, contract: null, visibility: null }],
      enabledCount: 0,
      toolControlView: null,
      workflowCapabilityView: null,
    });

    expect(first?.isConnected).toBe(false);
    expect(second).toBe(body.firstElementChild);
    expect(body.querySelector(".tool-item-name")?.textContent).toBe("second");
    expect(body.querySelector("input[type=checkbox]")?.checked).toBe(false);
    expect(view.render(null, {
      tools: [],
      enabledCount: 0,
      toolControlView: null,
      workflowCapabilityView: null,
    })).toBeNull();
  });

  it("keeps owner rendering before the existing Builtin toggle-listener assembly", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "apps/web/public/app/features/tool-settings.js"), "utf8");
    const builtinStart = source.indexOf("function renderBuiltinTab(tools, disabledList, contractsByName, visibilityByName, visibilityContext, toolControl, workflowCapability)");
    const builtinEnd = source.indexOf("function renderMCPTab", builtinStart);
    const builtinSource = source.slice(builtinStart, builtinEnd);
    const renderIndex = builtinSource.indexOf("toolSettingsBuiltinTabView.render(toolSettingsBody, {");
    const bindIndex = builtinSource.indexOf("bindToggleEvents();", renderIndex);

    expect(source).toContain([
      "import { createToolSettingsBuiltinTabView }",
      "from",
      '"./tool-settings-builtin-tab-view.js";',
    ].join(" "));
    expect(source).toContain(
      "const toolSettingsBuiltinTabView = createToolSettingsBuiltinTabView({",
    );
    expect(builtinSource).not.toContain("toolSettingsBody.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
    expect(builtinSource.slice(bindIndex)).toContain("bindToggleEvents();");
    expect(source).toContain("updateSaveButtonAvailability();");
  });
});
