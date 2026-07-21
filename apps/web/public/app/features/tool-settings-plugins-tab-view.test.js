// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createToolSettingsPluginsTabView } from "./tool-settings-plugins-tab-view.js";

const t = (_key, _params, fallback) => fallback ?? "";

describe("Tool Settings Plugins tab DOM owner", () => {
  it("renders plugin rows, visibility, and checkbox data as text, properties, and attributes without an HTML parser", () => {
    const body = document.createElement("div");
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(body, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Tool Settings Plugins tab must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createToolSettingsPluginsTabView({ ownerDocument: document, t });
      view.render(body, {
        plugins: [
          {
            name: 'zeta"><img src=x onerror="alert(1)">',
            checked: false,
            visibility: {
              available: false,
              label: '<svg onload="alert(2)">Blocked',
              alwaysEnabled: true,
              alwaysEnabledLabel: '<button onclick="alert(3)">Always',
              reasonMessage: '<iframe srcdoc="alert(4)">reason',
            },
          },
          {
            name: "alpha-plugin",
            checked: true,
            visibility: {
              available: true,
              label: "Visible in Current Context",
              alwaysEnabled: false,
              alwaysEnabledLabel: "Always Enabled",
              reasonMessage: "",
            },
          },
          {
            name: "no-visibility-plugin",
            checked: true,
            visibility: null,
          },
        ],
        enabledCount: 2,
        toolControlView: {
          context: '<img src=x onerror="alert(5)">Agent: alpha',
          details: ['<svg onload="alert(6)">Tool Control: Confirm'],
          scopeLines: ['<button onclick="alert(7)">scope'],
          launchExplainabilityLines: ['<iframe srcdoc="alert(8)">launch'],
          runtimeLines: ['<img src=x onerror="alert(9)">runtime'],
        },
      });

      expect([...body.children].map((child) => child.className)).toEqual([
        "tool-section-header",
        "tool-settings-context",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-item",
        "tool-item",
        "tool-item disabled unavailable",
      ]);
      expect(body.querySelector(".tool-section-header")?.textContent).toBe("Plugins2/3 enabled");
      expect(body.querySelector(".tool-settings-context")?.textContent).toBe(
        '<img src=x onerror="alert(5)">Agent: alpha',
      );
      expect([...body.querySelectorAll(".tool-settings-policy-note")].map((node) => node.textContent)).toEqual([
        '<svg onload="alert(6)">Tool Control: Confirm',
        '<button onclick="alert(7)">scope',
        '<iframe srcdoc="alert(8)">launch',
        '<img src=x onerror="alert(9)">runtime',
      ]);

      const rows = [...body.querySelectorAll(".tool-item")];
      expect(rows.map((row) => row.querySelector(".tool-item-name")?.textContent)).toEqual([
        "alpha-plugin",
        "no-visibility-plugin",
        'zeta"><img src=x onerror="alert(1)">',
      ]);
      expect(rows[0]?.querySelector(".tool-contract-badge")?.className).toBe(
        "tool-contract-badge visibility-available",
      );
      expect(rows[1]?.querySelector(".tool-visibility-badges")).toBeNull();
      expect(rows[1]?.querySelector(".tool-visibility-reason")).toBeNull();

      const zetaInput = rows[2]?.querySelector("input[type=checkbox]");
      expect(zetaInput?.checked).toBe(false);
      expect(zetaInput?.getAttribute("data-category")).toBe("plugins");
      expect(zetaInput?.getAttribute("data-name")).toBe('zeta"><img src=x onerror="alert(1)">');
      expect(rows[2]?.querySelector(".tool-visibility-badges")?.textContent).toBe(
        '<svg onload="alert(2)">Blocked<button onclick="alert(3)">Always',
      );
      expect(rows[2]?.querySelector(".tool-visibility-reason")?.textContent).toBe(
        '<iframe srcdoc="alert(4)">reason',
      );
      expect(body.querySelector("img, svg, iframe, button[onclick], [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(body, "innerHTML", descriptor);
    }
  });

  it("replaces old rows and ignores a missing body", () => {
    const view = createToolSettingsPluginsTabView({ ownerDocument: document, t });
    const body = document.createElement("div");
    const first = view.render(body, {
      plugins: [{ name: "first-plugin", checked: true, visibility: null }],
      enabledCount: 1,
      toolControlView: null,
    });
    const second = view.render(body, {
      plugins: [{ name: "second-plugin", checked: false, visibility: null }],
      enabledCount: 0,
      toolControlView: null,
    });

    expect(first?.isConnected).toBe(false);
    expect(second).toBe(body.firstElementChild);
    expect(body.querySelector(".tool-item-name")?.textContent).toBe("second-plugin");
    expect(body.querySelector("input[type=checkbox]")?.checked).toBe(false);
    expect(view.render(null, { plugins: [], enabledCount: 0, toolControlView: null })).toBeNull();
  });

  it("keeps owner rendering before the existing Plugins toggle-listener assembly", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "apps/web/public/app/features/tool-settings.js"), "utf8");
    const pluginsStart = source.indexOf("function renderPluginsTab(pluginList, disabledList, visibilityByPlugin, visibilityContext, toolControl)");
    const pluginsEnd = source.indexOf("function renderMethodsTab", pluginsStart);
    const pluginsSource = source.slice(pluginsStart, pluginsEnd);
    const renderIndex = pluginsSource.indexOf("toolSettingsPluginsTabView.render(toolSettingsBody, {");
    const bindIndex = pluginsSource.indexOf("bindToggleEvents();", renderIndex);

    expect(source).toContain([
      "import { createToolSettingsPluginsTabView }",
      "from",
      '"./tool-settings-plugins-tab-view.js";',
    ].join(" "));
    expect(source).toContain(
      "const toolSettingsPluginsTabView = createToolSettingsPluginsTabView({",
    );
    expect(pluginsSource).not.toContain("toolSettingsBody.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
    expect(pluginsSource.slice(bindIndex)).toContain("bindToggleEvents();");
    expect(source).toContain("updateSaveButtonAvailability();");
  });
});
