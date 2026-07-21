// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createToolSettingsMcpTabView } from "./tool-settings-mcp-tab-view.js";

const t = (_key, _params, fallback) => fallback ?? "";

describe("Tool Settings MCP tab DOM owner", () => {
  it("renders servers, tool names, visibility, and checkbox data as text, properties, and attributes without an HTML parser", () => {
    const body = document.createElement("div");
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(body, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Tool Settings MCP tab must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createToolSettingsMcpTabView({ ownerDocument: document, t });
      view.render(body, {
        servers: [
          {
            id: 'zeta"><img src=x onerror="alert(1)">',
            tools: [],
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
            id: "alpha",
            tools: [
              'mcp_alpha_read<svg onload="alert(5)">',
              "mcp_alpha_write",
            ],
            checked: true,
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
        "tool-item",
        "tool-item disabled unavailable",
      ]);
      expect(body.querySelector(".tool-section-header")?.textContent).toBe("MCP Servers1/2 enabled");
      expect(body.querySelector(".tool-settings-context")?.textContent).toBe(
        '<img src=x onerror="alert(6)">Agent: alpha',
      );
      expect([...body.querySelectorAll(".tool-settings-policy-note")].map((node) => node.textContent)).toEqual([
        '<svg onload="alert(7)">Tool Control: Confirm',
        '<button onclick="alert(8)">scope',
        '<iframe srcdoc="alert(9)">launch',
        '<img src=x onerror="alert(10)">runtime',
      ]);

      const rows = [...body.querySelectorAll(".tool-item")];
      expect(rows.map((row) => row.querySelector(".tool-item-name")?.textContent)).toEqual([
        "alpha",
        'zeta"><img src=x onerror="alert(1)">',
      ]);
      expect(rows[0]?.querySelector(".skill-desc")?.textContent).toBe('read<svg onload="alert(5)">, write');
      expect(rows[0]?.querySelector(".skill-meta")).toBeNull();
      expect(rows[0]?.querySelector(".tool-contract-badge")?.className).toBe(
        "tool-contract-badge visibility-available",
      );
      expect(rows[1]?.querySelector(".skill-desc")).toBeNull();
      expect(rows[1]?.querySelector(".skill-meta")?.textContent).toBe("No tools");

      const zetaInput = rows[1]?.querySelector("input[type=checkbox]");
      expect(zetaInput?.checked).toBe(false);
      expect(zetaInput?.getAttribute("data-category")).toBe("mcp_servers");
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
    const view = createToolSettingsMcpTabView({ ownerDocument: document, t });
    const body = document.createElement("div");
    const first = view.render(body, {
      servers: [{ id: "first", tools: ["mcp_first_read"], checked: true, visibility: null }],
      enabledCount: 1,
      toolControlView: null,
    });
    const second = view.render(body, {
      servers: [{ id: "second", tools: [], checked: false, visibility: null }],
      enabledCount: 0,
      toolControlView: null,
    });

    expect(first?.isConnected).toBe(false);
    expect(second).toBe(body.firstElementChild);
    expect(body.querySelector(".tool-item-name")?.textContent).toBe("second");
    expect(body.querySelector(".skill-meta")?.textContent).toBe("No tools");
    expect(body.querySelector("input[type=checkbox]")?.checked).toBe(false);
    expect(view.render(null, { servers: [], enabledCount: 0, toolControlView: null })).toBeNull();
  });

  it("keeps owner rendering before the existing MCP toggle-listener assembly", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "apps/web/public/app/features/tool-settings.js"), "utf8");
    const mcpStart = source.indexOf("function renderMCPTab(mcpServers, disabledList, visibilityByServer, visibilityContext, toolControl)");
    const mcpEnd = source.indexOf("function renderPluginsTab", mcpStart);
    const mcpSource = source.slice(mcpStart, mcpEnd);
    const renderIndex = mcpSource.indexOf("toolSettingsMcpTabView.render(toolSettingsBody, {");
    const bindIndex = mcpSource.indexOf("bindToggleEvents();", renderIndex);

    expect(source).toContain([
      "import { createToolSettingsMcpTabView }",
      "from",
      '"./tool-settings-mcp-tab-view.js";',
    ].join(" "));
    expect(source).toContain(
      "const toolSettingsMcpTabView = createToolSettingsMcpTabView({",
    );
    expect(mcpSource).not.toContain("toolSettingsBody.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
    expect(mcpSource.slice(bindIndex)).toContain("bindToggleEvents();");
    expect(source).toContain("updateSaveButtonAvailability();");
  });
});
